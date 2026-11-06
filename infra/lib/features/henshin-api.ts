import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import * as path from 'path';

export interface HenshinApiProps {
    /** CloudFrontのURL (CORS対策) */
    frontendUrl: string;
    userPoolId: string;
    userPoolClientId: string;
}

export class HenshinApiConstruct extends Construct {

    public readonly lambdaApiUrl: string;

    constructor(scope: Construct, id: string, props: HenshinApiProps) {
        super(scope, id);

        // =========================================================
        // Lambda 作成: (Bedrock連携)
        // CDKが自動でTypeScriptをビルド＆バンドルしてくれます
        // =========================================================
        const henshinLambda = new NodejsFunction(this, 'HenshinStreamLambda', {
            runtime: lambda.Runtime.NODEJS_24_X,
            entry: path.join(__dirname, '../../../backend/henshin/index.ts'),
            handler: 'handler',                 // index.ts内の export const handler を指定
            timeout: cdk.Duration.seconds(60),  // ストリーミング用に長めのタイムアウトを設定
            environment: {
                USER_POOL_ID: props.userPoolId,
                CLIENT_ID: props.userPoolClientId,
                FRONTEND_URL: props.frontendUrl,
            }
        });

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
        const lambdaDistribution = new cloudfront.Distribution(this, 'LambdaApiDistribution', {
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