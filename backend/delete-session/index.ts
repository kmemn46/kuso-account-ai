import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
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
        "Access-Control-Allow-Methods": "OPTIONS,DELETE",
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
        "Content-Type": "application/json",
    };

    const httpMethod = event.requestContext?.http?.method || 'GET';

    // OPTIONS（プリフライト）リクエストの対応
    if (httpMethod === "OPTIONS") {
        return { statusCode: 200, headers, body: "" };
    }

    try {

        // クエリパラメータから sessionId を取得する
        const sessionId = event.queryStringParameters?.sessionId;
        if (!sessionId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: "Missing sessionId parameter" }),
            };
        }

        // 該当する sessionId を持つすべてのレコード（メタデータ＋メッセージ）を検索する
        const queryCommand = new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: "sessionId = :sessionId",
            ExpressionAttributeValues: {
                ":sessionId": sessionId,
            },
        });

        const queryResponse = await docClient.send(queryCommand);
        const items = queryResponse.Items || [];

        // 見つかったレコードをすべて個別に削除する
        for (const item of items) {
            const deleteCommand = new DeleteCommand({
                TableName: TABLE_NAME,
                Key: {
                    sessionId: item.sessionId,
                    timestamp: item.timestamp,
                },
            });
            await docClient.send(deleteCommand);
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ message: "Session deleted successfully" }),
        };

    } catch (error: any) {
        console.error("Error deleting session:", error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ message: "Internal Server Error", error: String(error) }),
        }
    }


}
