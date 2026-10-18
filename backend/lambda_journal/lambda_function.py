import json
import os
from datetime import datetime
from langchain_aws import ChatBedrock
from pydantic import BaseModel, Field
import boto3

# データ構造（型）をPydanticで定義
class JournalEntry(BaseModel):
    category: str = Field(description="出来事のカテゴリ（例：恋愛、健康、浪費など）")
    debit_account: str = Field(description="借方科目（例：メンタル減損損失、将来投資資産）")
    credit_account: str = Field(description="貸方科目（例：淡い期待資産、現預金）")
    amount: int = Field(description="算定された金額（円）")
    financial_statement_impact: str = Field(description="B/S・P/Lへの影響解説")
    positive_comment: str = Field(description="自己肯定感を爆上げする無理やりなポジティブ解説")

# AWSクライアントとLangChainの初期化
dynamodb = boto3.resource('dynamodb')
TABLE_NAME = os.environ['TABLE_NAME']
table = dynamodb.Table(TABLE_NAME)

llm = ChatBedrock(
    model_id = "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    model_kwargs = {"temperature": 0.7}
)
structured_llm = llm.with_structured_output(JournalEntry)

# CloudFrontのURLを取得
CLOUDFRONT_URL = os.environ.get("CLOUDFRONT_URL", "*")

# Lambdaのエントリーポイント (メイン処理)
def lambda_handler(event, context):
    try:
        # API Gateway経由のリクエストボディを取得
        body = json.loads(event.get('body', {})) if isinstance(event.get('body'), str) else event.get('body', {})
        user_event = body.get('user_event', '既読無視された')
        user_id = body.get('user_id', 'USER#123') # 本来は認証情報から取得

        # 現在日時とPK/SKの生成
        now = datetime.now()
        current_month = now.strftime('%Y-%m')  # 例： "2026-10"
        timestamp = now.isoformat()

        # PK
        pk = f"{user_id}#{current_month}"

        # BedrockでAI仕訳
        prompt = f"""
        あなたは令和の最強ギャル簿記アナリストです。
        ユーザーの出来事を無理やり複式簿記（借方・貸方）に仕訳してください。
        【入力された出来事】: {user_event}
        """
        journal_data = structured_llm.invoke(prompt)

        # DynamoDBに保存するアイテム
        item = {
            'UserId_Month': pk,          # PK
            'TransactionId': timestamp,  # SK
            'user_event': user_event,
            'category': journal_data.category,
            'debit_account': journal_data.debit_account,
            'credit_account': journal_data.credit_account,
            'amount': journal_data.amount,
            'financial_statement_impact': journal_data.financial_statement_impact,
            'positive_comment': journal_data.positive_comment,
            'created_at': timestamp
        }

        # DynamoDBに保存
        table.put_item(Item=item)

        # 成功レスポンス返却 (API Gateway用)
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': CLOUDFRONT_URL,  # CORS対策
                "Access-Control-Allow-Headers": "Content-Type,Authorization",
                "Access-Control-Allow-Methods": "OPTIONS,POST,GET"
            },
            'body': json.dumps({
                'message': '仕訳データの生成と保存が完了したよ！✨',
                'data': item
            }, ensure_ascii=False)
        }

    except Exception as e:
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({'error': str(e)})
        }