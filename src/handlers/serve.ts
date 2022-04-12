import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { CloudFrontResponseEvent } from 'aws-lambda';
import { Readable } from 'stream';

type ConfigType = { [project: string]: { allowedOrigins: string[] } };

let config: ConfigType | undefined;

const streamToString = (stream: Readable) =>
  new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });

const getConfig = (inputBucketName: string): Promise<ConfigType> =>
  new S3Client({ region: 'us-east-1' })
    .send(
      new GetObjectCommand({
        Bucket: inputBucketName,
        Key: 'config.json',
      }),
    )
    .then((response) => streamToString(response.Body as Readable))
    .then(JSON.parse);

export const lambdaHandler = async (event: CloudFrontResponseEvent) => {
  const request = event.Records[0]!.cf.request;
  const response = event.Records[0]!.cf.response;

  const originValue = request.headers?.origin?.[0]?.value;
  if (originValue === undefined) {
    return response;
  }

  const inputBucketName = request.headers?.['input-bucket-name']?.[0]?.value;
  if (inputBucketName === undefined) {
    throw new Error('Missing input bucket name header');
  }

  if (config === undefined) {
    config = await getConfig(inputBucketName);
  }

  const project = request.uri.split('/')?.[1];
  if (project !== undefined) {
    if (config[project]?.allowedOrigins.includes(originValue)) {
      response.headers['access-control-allow-origin'] = [{ key: 'Access-Control-Allow-Origin', value: originValue }];
      response.headers['vary'] = [{ key: 'Vary', value: 'Origin' }];
      console.log(`Allowed origin ${originValue} in project ${project}`);
    } else {
      console.log(`Failed to find origin ${originValue} in project ${project}`);
    }
  } else {
    console.log(`Failed to find project ${project}`);
  }
  return response;
};
