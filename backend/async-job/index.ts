import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';

// パラメータ設定（環境変数などから取得）
const region = process.env.AWS_REGION || "us-east-1";
const dynamoClient = new DynamoDBClient({ region });           // DynamoDB クライアントの初期化
const docClient = DynamoDBDocumentClient.from(dynamoClient);   // DynamoDB クライアントのラッパー

const FRONTEND_URL = process.env.FRONTEND_URL || '*';
const TABLE_NAME = process.env.TABLE_NAME || "";

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> => {

    const headers = {
        "Access-Control-Allow-Origin": FRONTEND_URL,
        "Access-Control-Allow-Methods": "OPTIONS,GET",
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
        "Content-Type": "application/json",
    };

    const httpMethod = event.requestContext?.http?.method || 'GET';

    // OPTIONS（プリフライト）リクエストの対応
    if (httpMethod === "OPTIONS") {
        return { statusCode: 200, headers, body: "" };
    }

    try {

        const claims = event.requestContext?.authorizer?.jwt?.claims
        if (!claims) {
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ message: "Unauthorized: Token claims are missing" }),
            };
        }

        const jobId = event.pathParameters?.jobId;
        if (!jobId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ message: 'jobId is required' }),
            };
        }

        const result = await docClient.send(
            new GetCommand({
                TableName: TABLE_NAME,
                Key: { jobId },
            })
        );

        // まだ Step Functions が実行中で DynamoDB に保存されていない場合
        if (!result.Item) {
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    jobId,
                    status: 'PROCESSING',
                }),
            };
        }

        // 保存完了している場合（COMPLETED）
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(result.Item),
        };

    } catch (error: any) {
        console.error("Error fetching step function result with jobId:", error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ message: "Internal Server Error", error: String(error) }),
        }
    }

}
