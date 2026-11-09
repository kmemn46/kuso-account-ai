import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export interface AiBackendProps {
    /** 環境 */
    envName: string;
    removalPolicy: cdk.RemovalPolicy;
    /** 書き込み・AI処理用Lambdaのソースコードのファイルパス */
    writeLambdaEntryPath: string;
    /** 読み込み用Lambdaのソースコードのファイルパス */
    readLambdaEntryPath: string;
    /** Lambdaレイヤーのソースコードのファイルパス（オプション） */
    layerEntryPath?: string;
    /** CloudFrontのURL (CORS対策) */
    frontendUrl: string;
}

export class AiBackendConstruct extends Construct {

    // 外部ファイルから参照できるように公開するプロパティ
    public readonly writeLambda: lambda.Function;
    public readonly readLambda: lambda.Function;
    public readonly dataTable: dynamodb.Table;
    public readonly aiLayer?: lambda.LayerVersion;

    constructor(scope: Construct, id: string, props: AiBackendProps) {
        super(scope, id);

        // ==========================================
        // 1. DynamoDBの作成
        // ==========================================
        this.dataTable = new dynamodb.Table(this, 'AiDataTable', {
            tableName: `${props.envName}-positive-ai-dataTable`,
            partitionKey: { name: 'UserId_Month', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'TransactionId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,        // オンデマンド
            removalPolicy: props.removalPolicy,
        });

        // ==========================================
        // 2. Lambdaレイヤーの作成
        // ==========================================
        let layers: lambda.ILayerVersion[] = [];
        if (props.layerEntryPath) {
            this.aiLayer = new lambda.LayerVersion(this, 'AiLayer', {
                layerVersionName: `${props.envName}-positive-ai-dependencies-layer`,
                code: lambda.Code.fromAsset(props.layerEntryPath),
                compatibleRuntimes: [lambda.Runtime.PYTHON_3_12],
                description: `Shared libraries and modules for backend functions (${props.envName})`,
                removalPolicy: cdk.RemovalPolicy.DESTROY,     // Lambdaレイヤーは削除
            });
            layers.push(this.aiLayer);
        }

        // =========================================================
        // 3. Lambda 仕訳用作成: (DynamoDB、Bedrock連携)
        // =========================================================
        this.writeLambda = new lambda.Function(this, 'LambdaJournalFunction', {
            functionName: `${props.envName}-positive-ai-journal`,
            runtime: lambda.Runtime.PYTHON_3_12,
            handler: 'lambda_journal.lambda_handler',
            code: lambda.Code.fromAsset(props.writeLambdaEntryPath),
            timeout: cdk.Duration.seconds(30),
            layers: layers,
            environment: {
                TABLE_NAME: this.dataTable.tableName,
                FRONTEND_URL: props.frontendUrl,
            },
        });

        // ==============================================
        // 4. Lambda 集計用作成: (DynamoDB連携)
        // ==============================================
        this.readLambda = new lambda.Function(this, 'LambdaSummaryFunction', {
            functionName: `${props.envName}-positive-ai-summary`,
            runtime: lambda.Runtime.PYTHON_3_12,
            handler: 'lambda_summary.lambda_handler',
            code: lambda.Code.fromAsset(props.readLambdaEntryPath),
            timeout: cdk.Duration.seconds(30),
            environment: {
                TABLE_NAME: this.dataTable.tableName,
                FRONTEND_URL: props.frontendUrl,
            },
        });

        // ==============================================
        // 5. 権限の割り当て
        // ==============================================
        // 書き込み用には、DynamoDBの書き込みと、Bedrockの呼び出し権限を付与
        this.dataTable.grantWriteData(this.writeLambda);

        // Bedrock呼び出しのIAMポリシーを定義
        const bedrockPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['bedrock:InvokeModel'],
            resources: ['*'],
        });
        this.writeLambda.addToRolePolicy(bedrockPolicy);

        // 読み込み用には、DynamoDBの読み込み権限を付与
        this.dataTable.grantReadData(this.readLambda);

    }


}