import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import * as path from 'path';

export interface HenshinApiProps {
    /** 環境 */
    envName: string;
    removalPolicy: cdk.RemovalPolicy;
    /** CloudFrontのURL (CORS対策) */
    frontendUrl: string;
    userPoolId: string;
    userPoolClientId: string;
    /** BedrockのモデルID */
    bedrockModelId: string;
    bedrockImageModelId: string;
}

export class HenshinApiConstruct extends Construct {

    public readonly lambdaApiUrl: string;

    constructor(scope: Construct, id: string, props: HenshinApiProps) {
        super(scope, id);

        const {
            envName,
            removalPolicy,
            frontendUrl,
            userPoolId,
            userPoolClientId,
            bedrockModelId,
            bedrockImageModelId,
        } = props;

        const functionName = `${envName}-henshin-api`
        cdk.Tags.of(this).add('AppRole', 'HenshinAI-BackendApi');

        // =========================================================
        // Lambda 作成: (Bedrock連携)
        // CDKが自動でTypeScriptをビルド＆バンドルしてくれます
        // =========================================================
        // SSM Parameter StoreにBedrockのモデルIDを設定
        // text用
        const modelIdParam = new ssm.StringParameter(this, 'BedrockModelIdParameter', {
            parameterName: `/henshin-ai/${envName}/bedrock-model-id`,
            stringValue: bedrockModelId,
            description: `Bedrock Model ID for PositiveAI (${envName})`,
        });

        // image用
        const imageModelIdParam = new ssm.StringParameter(this, 'BedrockImageModelIdParameter', {
            parameterName: `/henshin-ai/${envName}/bedrock-image-model-id`,
            stringValue: bedrockImageModelId,
            description: `Bedrock Image Model ID for PositiveAI (${envName})`,
        });

        // ロググループを明示的に作成する
        const logGroup = new logs.LogGroup(this, 'HenshinLogGroup', {
            logGroupName: `/aws/lambda/${functionName}`,
            removalPolicy: removalPolicy,
            retention: logs.RetentionDays.ONE_WEEK,
        });

        const henshinLambda = new NodejsFunction(this, 'HenshinStreamLambda', {
            functionName: functionName,
            runtime: lambda.Runtime.NODEJS_24_X,
            entry: path.join(__dirname, '../../../backend/henshin/index.ts'),
            handler: 'handler',                 // index.ts内の export const handler を指定
            timeout: cdk.Duration.seconds(60),  // ストリーミング用に長めのタイムアウトを設定
            logGroup: logGroup,
            environment: {
                USER_POOL_ID: userPoolId,
                CLIENT_ID: userPoolClientId,
                FRONTEND_URL: frontendUrl,
                BEDROCK_PARAMETER_NAME: modelIdParam.parameterName,
                BEDROCK_PARAMETER_NAME_FOR_IMAGE: imageModelIdParam.parameterName,
            }
        });

        // LambdaにSSMパラメータを読む権限を付与する
        modelIdParam.grantRead(henshinLambda);
        imageModelIdParam.grantRead(henshinLambda);

        // Bedrock呼び出し権限の付与
        henshinLambda.addToRolePolicy(new iam.PolicyStatement ({
            actions: [
                'bedrock:InvokeModelWithResponseStream',
                'bedrock:InvokeModel',
            ],
            resources: ['*'], // 本番環境では特定のモデルARNに絞るとより安全
        }));

        // レスポンスストリーミング対応の関数URLを発行
        const functionUrl = henshinLambda.addFunctionUrl({
            authType: lambda.FunctionUrlAuthType.AWS_IAM,   // CloudFrontとのOACのため
            invokeMode: lambda.InvokeMode.RESPONSE_STREAM,  // ストリーミングモードを有効化
        });

        // Lambda専用のCloudfrontディストリビューションを作成
        const lambdaDistribution = new cloudfront.Distribution(this, 'HenshinDistribution', {
            comment: `Henshin API Distribution (${envName})`,
            defaultBehavior: {
                origin: origins.FunctionUrlOrigin.withOriginAccessControl(functionUrl),       // OACの設定
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,      // HTTPS強制
                allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
                cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED, // ストリーミング用にキャッシュ無効化
                originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
                responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS_WITH_PREFLIGHT,
            },
        });

        // 環境変数設定用
        this.lambdaApiUrl = `https://${lambdaDistribution.distributionDomainName}`;

    }

}