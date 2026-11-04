import * as cdk from 'aws-cdk-lib';
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

    public readonly functionUrl: lambda.FunctionUrl;

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
        this.functionUrl = henshinLambda.addFunctionUrl({
            authType: lambda.FunctionUrlAuthType.NONE,      // 開発用（必要に応じてIAM等に変更可能）
            invokeMode: lambda.InvokeMode.RESPONSE_STREAM,  // ストリーミングモードを有効化
            cors: {
                allowedOrigins: [props.frontendUrl],     // 許可するオリジン（開発時は '*' または 'http://localhost:3000'）
                allowedMethods: [lambda.HttpMethod.GET, lambda.HttpMethod.POST], // 許可するHTTPメソッド（GET, POSTなど）
                allowedHeaders: ['Authorization', 'Content-Type'], // 許可するヘッダー（JWTトークンを送るための 'Authorization' や 'Content-Type' を指定
            }
        });
    }

}