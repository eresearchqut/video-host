import { S3Event } from 'aws-lambda';
import {
  CreateJobCommand,
  DescribeEndpointsCommand,
  MediaConvertClient,
  OutputGroupType,
} from '@aws-sdk/client-mediaconvert';
import { ulid } from 'ulid';

const { OUTPUT_BUCKET_NAME, MEDIACONVERT_ROLE_ARN } = process.env;

let mediaConvertClient: MediaConvertClient;

async function getMediaConvertClient() {
  const endpoints = await new MediaConvertClient({}).send(new DescribeEndpointsCommand({}));
  const endpoint = endpoints.Endpoints?.[0]?.Url;
  if (endpoint === undefined) {
    throw new Error('Failed to find mediaconvert endpoint');
  }
  return new MediaConvertClient({ endpoint });
}

export const lambdaHandler = async (event: S3Event) => {
  if (mediaConvertClient === undefined) {
    mediaConvertClient = await getMediaConvertClient();
  }

  return Promise.all(
    event.Records.map(async (record) => {
      const fileKey = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

      const project = fileKey.split('/')[1];
      if (project === undefined) {
        throw new Error('Missing project');
      }

      const jobId = ulid();

      return mediaConvertClient.send(
        new CreateJobCommand({
          Role: MEDIACONVERT_ROLE_ARN,
          Settings: {
            Inputs: [
              {
                FileInput: `s3://${record.s3.bucket.name}/${fileKey}`,
                AudioSelectors: {
                  'Audio Selector 1': {
                    DefaultSelection: 'DEFAULT',
                    SelectorType: 'TRACK',
                  },
                },
              },
            ],
            OutputGroups: [
              {
                Name: 'POSTER',
                Outputs: [
                  {
                    VideoDescription: {
                      CodecSettings: {
                        Codec: 'FRAME_CAPTURE',
                        FrameCaptureSettings: {
                          Quality: 80,
                          FramerateNumerator: 1,
                          FramerateDenominator: 3,
                          MaxCaptures: 20,
                        },
                      },
                    },
                    ContainerSettings: {
                      Container: 'RAW',
                    },
                  },
                ],
                OutputGroupSettings: {
                  Type: OutputGroupType.FILE_GROUP_SETTINGS,
                  FileGroupSettings: {
                    Destination: `s3://${OUTPUT_BUCKET_NAME}/${project}/${jobId}/poster/`,
                  },
                },
              },
              {
                Name: 'MP4',
                Outputs: [
                  {
                    Preset: 'System-Generic_Hd_Mp4_Avc_Aac_16x9_1920x1080p_24Hz_6Mbps',
                    Extension: 'mp4',
                    NameModifier: '_avc_1080p',
                  },
                  {
                    Preset: 'System-Generic_Hd_Mp4_Avc_Aac_16x9_1280x720p_24Hz_4.5Mbps',
                    Extension: 'mp4',
                    NameModifier: '_avc_720p',
                  },
                  {
                    Preset: 'System-Generic_Sd_Mp4_Avc_Aac_4x3_640x480p_24Hz_1.5Mbps',
                    Extension: 'mp4',
                    NameModifier: '_avc_480p',
                  },
                ],
                OutputGroupSettings: {
                  Type: OutputGroupType.FILE_GROUP_SETTINGS,
                  FileGroupSettings: {
                    Destination: `s3://${OUTPUT_BUCKET_NAME}/${project}/${jobId}/mp4/`,
                  },
                },
              },
              {
                Name: 'HLS',
                Outputs: [
                  {
                    VideoDescription: {
                      CodecSettings: {
                        Codec: 'H_264',
                        H264Settings: {
                          RateControlMode: 'QVBR',
                          SceneChangeDetect: 'TRANSITION_DETECTION',
                          QualityTuningLevel: 'MULTI_PASS_HQ',
                          FramerateControl: 'INITIALIZE_FROM_SOURCE',
                        },
                      },
                    },
                    AudioDescriptions: [
                      {
                        CodecSettings: {
                          Codec: 'AAC',
                          AacSettings: {
                            Bitrate: 96000,
                            CodingMode: 'CODING_MODE_2_0',
                            SampleRate: 48000,
                          },
                        },
                      },
                    ],
                    OutputSettings: {
                      HlsSettings: {},
                    },
                    ContainerSettings: {
                      Container: 'M3U8',
                      M3u8Settings: {},
                    },
                  },
                ],
                AutomatedEncodingSettings: {
                  AbrSettings: {},
                },
                OutputGroupSettings: {
                  Type: OutputGroupType.HLS_GROUP_SETTINGS,
                  HlsGroupSettings: {
                    Destination: `s3://${OUTPUT_BUCKET_NAME}/${project}/${jobId}/hls/`,
                    MinSegmentLength: 0,
                    SegmentLength: 10,
                  },
                },
              },
              {
                Name: 'CMAF',
                Outputs: [
                  {
                    VideoDescription: {
                      CodecSettings: {
                        Codec: 'H_264',
                        H264Settings: {
                          RateControlMode: 'QVBR',
                          SceneChangeDetect: 'TRANSITION_DETECTION',
                          QualityTuningLevel: 'MULTI_PASS_HQ',
                          FramerateControl: 'INITIALIZE_FROM_SOURCE',
                        },
                      },
                    },
                    ContainerSettings: {
                      Container: 'CMFC',
                    },
                  },
                  {
                    AudioDescriptions: [
                      {
                        CodecSettings: {
                          Codec: 'AAC',
                          AacSettings: {
                            Bitrate: 96000,
                            CodingMode: 'CODING_MODE_2_0',
                            SampleRate: 48000,
                          },
                        },
                      },
                    ],
                    ContainerSettings: {
                      Container: 'CMFC',
                    },
                  },
                ],
                AutomatedEncodingSettings: {
                  AbrSettings: {},
                },
                OutputGroupSettings: {
                  Type: OutputGroupType.CMAF_GROUP_SETTINGS,
                  CmafGroupSettings: {
                    Destination: `s3://${OUTPUT_BUCKET_NAME}/${project}/${jobId}/cmaf/`,
                    SegmentLength: 10,
                    FragmentLength: 2,
                  },
                },
              },
            ],
          },
        }),
      );
    }),
  );
};
