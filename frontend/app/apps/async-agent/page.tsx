'use client';

import { getAccessToken } from '@/lib/auth';
import Link from 'next/link';
import React, { useEffect, useState } from 'react';

// API Gatewayエンドポイント
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

interface AsyncJobResult {
    jobId: string;
    status: 'PROCESSING' | 'COMPLETED' | 'FAILED';
    topic?: string;
    researchResult?: string;
    outlineResult?: string;
    updatedAt?: string;
}

export default function AsyncAgentPage() {

    const [topic, setTopic] = useState('');
    const [jobId, setJobId] = useState<string | null>(null);
    const [jobResult, setJobResult] = useState<AsyncJobResult | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // 結果取得ポーリング（GET /async-jobs/{jobId}）
    useEffect(() => {
        if (!jobId || jobResult?.status === 'COMPLETED') return;

        const intervalId = setInterval(async () => {
            try {
                const token = await getAccessToken();
                if (!token) {
                    alert('アクセストークンが見つかりません。ログインしてください。');
                    return;
                }

                const res = await fetch(`${API_BASE_URL}/async-jobs/${jobId}`, {
                    method: 'GET',
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                });

                if (!res.ok) return;

                const data: AsyncJobResult = await res.json();
                setJobResult(data);

                // 完了したらポーリングを自動停止
                if (data.status === 'COMPLETED') {
                    clearInterval(intervalId);
                }

            } catch (err) {
                console.error('ポーリング中のエラー:', err);
            }
        }, 3000); // 3秒おきに確認

        // コンポーネントのアンマウント時や再実行時にタイマーをクリーンアップ
        return () => clearInterval(intervalId);

    }, [jobId, jobResult?.status]);


    // ジョブ投入（POST /async-jobs）
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault(); // ページリロードによるCloudFrontのXMLエラーを防止！

        if (!topic.trim()) return;

        setIsSubmitting(true);
        setError(null);
        setJobResult(null);

        // フロント側で一意の jobId を発行
        const newJobId = crypto.randomUUID();

        try {
            const token = await getAccessToken();
            if (!token) {
                alert('アクセストークンが見つかりません。ログインしてください。');
                return;
            }

            const res = await fetch(`${API_BASE_URL}/async-jobs`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({
                    jobId: newJobId,
                    topic: topic.trim(),
                }),
            });

            if (!res.ok) {
                throw new Error(`リクエストエラー: ${res.status}`);
            }

            // SQSへの投入が成功したら jobId をセットしてポーリング開始
            setJobId(newJobId);
            setJobResult({ jobId: newJobId, status: 'PROCESSING' });


        } catch (err: any) {
            setError(err.message || '送信中にエラーが発生しました');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <main className="min-h-screen bg-gradient-to-b from-purple-900 via-indigo-900 to-black text-white p-8 flex flex-col items-center justify-between">
            {/* 上部ナビゲーション */}
            <div className="w-full max-w-2xl flex justify-start">
                <Link
                    href="/"
                    className="text-sm bg-white/10 hover:bg-white/20 border border-white/20 px-4 py-2 rounded-xl transition-colors duration-200">
                    ← パーク入口に戻る
                </Link>
            </div>
            {/* ヘッダー部分 */}
            <header className="w-full max-w-4xl text-center space-y-2">
                <h1 className="text-3xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-purple-200 via-indigo-200 to-white">
                    スマート執筆ツール
                </h1>
                <p className="text-sm text-indigo-200/80">
                    SQS + EventBridge Pipes + Step Functions による多段AIワークフロー基盤
                </p>
            </header>

            {/* メインコンテンツエリア */}
            <div className="w-full max-w-4xl space-y-8 my-8">
                {/* 入力フォーム（半透明ダークカード） */}
                <form
                    onSubmit={handleSubmit}
                    className="space-y-4 bg-white/10 backdrop-blur-md p-6 rounded-xl border border-white/15 shadow-xl"
                >
                    <div>
                        <label className="block text-sm font-medium text-indigo-100 mb-2">
                            調査・記事作成したいテーマを入力してください
                        </label>
                        <input
                            type="text"
                            value={topic}
                            onChange={(e) => setTopic(e.target.value)}
                            placeholder="例: AWS Step FunctionsとBedrockを使ったサーバーレス設計"
                            className="w-full p-3 bg-black/40 border border-indigo-400/30 rounded-lg text-white placeholder-indigo-300/40 focus:ring-2 focus:ring-purple-400 focus:border-transparent focus:outline-none transition"
                            disabled={isSubmitting || jobResult?.status === 'PROCESSING'}
                        />
                    </div>

                    <div className="flex justify-end">
                        <button
                            type="submit"
                            disabled={isSubmitting || !topic.trim() || jobResult?.status === 'PROCESSING'}
                            className="px-6 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-medium rounded-lg shadow-lg shadow-purple-900/50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                        >
                            {isSubmitting ? 'キューへ送信中...' : 'AIワークフローを実行'}
                        </button>
                    </div>
                </form>

                {/* エラー表示 */}
                {error && (
                    <div className="p-4 bg-red-950/60 border border-red-500/50 text-red-200 rounded-xl backdrop-blur-sm">
                        {error}
                    </div>
                )}

                {/* 実行中（ポーリング中）のステータス表示 */}
                {jobResult?.status === 'PROCESSING' && (
                    <div className="p-6 bg-indigo-950/60 border border-indigo-400/40 rounded-xl backdrop-blur-md flex items-center space-x-4 shadow-lg">
                        <div className="animate-spin h-6 w-6 border-4 border-purple-400 border-t-transparent rounded-full shrink-0" />
                        <div>
                            <p className="font-semibold text-purple-100">
                                バックグラウンドでAIエージェントが稼働中です...
                            </p>
                            <p className="text-xs text-indigo-300/80 mt-1">
                                Job ID: {jobResult.jobId}（Step 1: 調査 → Step 2: 構成案作成 → DynamoDB保存）
                            </p>
                        </div>
                    </div>
                )}

                {/* 完了後の結果表示 */}
                {jobResult?.status === 'COMPLETED' && (
                    <div className="space-y-6">
                        <div className="p-4 bg-emerald-950/50 border border-emerald-500/40 rounded-xl text-emerald-200 text-sm flex flex-wrap justify-between gap-2 backdrop-blur-sm">
                            <span>✅ ワークフロー完了（DynamoDBから取得）</span>
                            <span className="font-mono text-xs text-emerald-300/80">
                                Job ID: {jobResult.jobId}
                            </span>
                        </div>

                        {/* Step 1 の出力 */}
                        <div className="bg-white/10 backdrop-blur-md p-6 rounded-xl border border-white/15 shadow-xl space-y-3">
                            <h2 className="text-lg font-bold text-purple-200 border-b border-white/10 pb-2">
                                🔍 Step 1: AIリサーチャーによる調査結果
                            </h2>
                            <div className="whitespace-pre-wrap text-indigo-50/90 leading-relaxed text-sm md:text-base">
                                {jobResult.researchResult}
                            </div>
                        </div>

                        {/* Step 2 の出力 */}
                        <div className="bg-white/10 backdrop-blur-md p-6 rounded-xl border border-white/15 shadow-xl space-y-3">
                            <h2 className="text-lg font-bold text-purple-200 border-b border-white/10 pb-2">
                                📝 Step 2: AIライターによる記事構成案
                            </h2>
                            <div className="whitespace-pre-wrap text-indigo-50/90 leading-relaxed text-sm md:text-base">
                                {jobResult.outlineResult}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* フッター部分（justify-between のバランス用） */}
            <footer className="w-full max-w-4xl text-center text-xs text-indigo-300/50">
                クソアプリ・テーマパーク - アトラクション #04
            </footer>
        </main>
    );

}
