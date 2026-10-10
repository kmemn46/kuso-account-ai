# kuso-account-ai

■ プロジェクト概要
・名称：ポジティブ決算 AI（フルスタック AI アプリケーション）
・概要：ユーザー入力された不満や課題を、AWS Bedrock (Claude 3 Haiku) を活用してポジティブな仕訳・集計データへ変換・可視化するフルスタック Web アプリ。

■ 担当領域・アーキテクチャ設計（フルスタック / 単独構築）
・フロントエンド：Next.js (App Router / Turbopack), Tailwind CSS v4（静的エクスポート配信）
・バックエンド：AWS API Gateway (HTTP API), AWS Lambda (Node.js), Amazon DynamoDB
・AI インテグレーション：Amazon Bedrock (Claude 3 Haiku), LangChain (Pydantic 構造化出力)
・インフラ・セキュリティ：Amazon S3, Amazon CloudFront (OAC 経由完全非公開配信), CORS 制御, Throttling

■ 技術的な工夫と成果
1. 高い型安全性を実現する AI 構造化出力設計
   プロンプト依存の揺らぎを排除するため、LangChain の `with_structured_output` と Pydantic を導入。LLM からのレスポンスを厳密な JSON 構造体に強制し、後続の DynamoDB 処理や画面描画の信頼性を極限まで高めた設計を実現。
2. 最小権限とセキュリティ・コストを意識したインフラ設計
   S3 バケットはパブリックアクセスを完全遮断し、CloudFront (OAC) 経由のみの最小権限アクセスを徹底。API Gateway では Throttling による DoS 対策と、本番 CloudFront Origin に限定した CORS 制御を導入し、不要なリクエストによるクラウドコストの肥大化リスクをシャットアウト。
