import * as cdk from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2Authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

// 外部から受け取る設定の型定義
export interface ServerlessAuthProps {
    /** 許可するオリジン (例：CloudFrontのURLなど) */
    allowedOrigins: string[];
}

/**
 * 認証・API基盤のCDKモジュール
 * ・Cognito User Pool の作成
 * ・API Gateway の作成
 */
export class ServerlessAuthConstruct extends Construct {

    // 外部ファイルから参照できるように公開するプロパティ
    public readonly userPool: cognito.UserPool;
    public readonly userPoolClient: cognito.UserPoolClient;
    public readonly httpApi: apigwv2.HttpApi;
    public readonly stage: apigwv2.HttpStage;
    public readonly jwtAuthorizer: apigwv2Authorizers.HttpJwtAuthorizer;

    constructor(scope: Construct, id: string, props: ServerlessAuthProps) {
        super(scope, id);

        // ==================================================
        // 1. Cognito User Poolの作成
        // ==================================================
        this.userPool = new cognito.UserPool(this, 'UserPool', {
            userPoolName: 'user-pool',
            selfSignUpEnabled: true,      // 自分でサインアップ可能
            signInCaseSensitive: false,
            signInAliases: {
                email: true,
                username: false,
            },
            autoVerify: { email: true },  // メールアドレス確認を有効化
            standardAttributes: {
                email: { required: true, mutable: true}
            },
            removalPolicy: cdk.RemovalPolicy.DESTROY,  // 開発用：スタック削除時にプールも削除される設定
        });

        // User Pool Clientの作成
        this.userPoolClient = this.userPool.addClient('UserPoolClient', {
            userPoolClientName: 'user-pool-client',
            generateSecret: false,   // クライアントシークレットは不要
        });

        // HTTP API用のJWTオーソライザーの設定
        const region = cdk.Stack.of(this).region;
        const issuerUri = `https://cognito-idp.${region}.amazonaws.com/${this.userPool.userPoolId}`;

        this.jwtAuthorizer = new apigwv2Authorizers.HttpJwtAuthorizer(
            'JwtAuthorizer',
            issuerUri,
            {
                jwtAudience: [this.userPoolClient.userPoolClientId],
            },
        );

        // ==========================================
        // 2. API Gatewayの作成 (HTTP API)
        // ==========================================
        this.httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
            apiName: 'Serverless App HTTP API',
            createDefaultStage: false,
            corsPreflight: {
                allowHeaders: ['Authorization', 'Content-Type'],
                allowMethods: [
                    apigwv2.CorsHttpMethod.GET,
                    apigwv2.CorsHttpMethod.POST,
                    apigwv2.CorsHttpMethod.OPTIONS,
                ],
                allowOrigins: props.allowedOrigins,
            },
        });

        // 明示的にステージを作成し、スロットリング(レート・バースト制限)を適用
        this.stage = new apigwv2.HttpStage(this, 'DefaultStage', {
            httpApi: this.httpApi,
            stageName: 'prod',
            autoDeploy: true,
            throttle: {
                rateLimit: 10,
                burstLimit: 20,
            },
        });
    }
}
