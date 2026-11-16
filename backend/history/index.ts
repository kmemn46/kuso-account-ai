import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
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
                body: JSON.stringify({ message: "Unauthorized: Missing user sub" }),
            };
        }

        // クエリパラメータから sessionId を取得する
        const sessionId = event.queryStringParameters?.sessionId;
        if (!sessionId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: "Missing sessionId parameter" }),
            };
        }

        // DynamoDBから該当セッションのメッセージをすべて取得する
        const queryResult = await docClient.send(
            new QueryCommand({
                TableName: TABLE_NAME,
                KeyConditionExpression: "sessionId = :sessionId",
                ExpressionAttributeValues: {
                    ":sessionId": sessionId,
                },
                ScanIndexForward: true, // trueにすることで古い順（時系列順）に並び替える
            })
        );

        const items = queryResult.Items || [];

        // 取得したアイテムの中から、メタデータ（timestamp === "METADATA"）を除外する
        const messageItems = items.filter((item) => item.timestamp !== "METADATA");

        // フロントエンドがそのまま使える形式（role と content）に整形して返す
        const messages = messageItems.map((item) => ({
            role: item.role,       // "user" または "assistant"
            content: item.content, // メッセージの本文
        }));

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ messages }),
        };

    } catch (error: any) {
        console.error("Error fetching chat history:", error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ message: "Internal Server Error", error: String(error) }),
        }
    }

}