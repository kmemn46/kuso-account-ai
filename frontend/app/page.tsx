'use client';

import { useState } from 'react';

// API Gatewayエンドポイント
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL;

export default function Home() {
  const [eventText, setEventText] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  // 集計用ステート
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryData, setSummaryData] = useState<any>(null);

  // 1. POST /journal (仕訳生成)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventText) return;
    setLoading(true);
    setResult(null);

    try {
      const res = await fetch(`${API_BASE_URL}/journal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_event: eventText,
          user_id: 'USER#123',
        }),
      });
      const data = await res.json();
      setResult(data);
    } catch (err) {
      alert('エラーが発生しちゃった😭 API URLやCORSを確認してみて！');
    } finally {
      setLoading(false);
    }
  };

  // 2. GET /summary (月別集計取得)
  const fetchSummary = async () => {
    setSummaryLoading(true);
    try {
      // 現在の年月（例：2026-10）を指定して取得
      const res = await fetch(`${API_BASE_URL}/summary?user_id=USER%23123&month=2026-10`)
      const data = await res.json();
      setSummaryData(data.summary);
    } catch (err) {
      alert('集計取得エラー😭 APIを確認してね！');
    } finally {
      setSummaryLoading(false);
    }
  };


  return (
    <main className="min-h-screen bg-pink-50 p-6 flex flex-col items-center justify-start space-y-6">
      {/* メインカード */}
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 border-4 border-pink-300">
        <h1 className="text-3xl font-extrabold text-pink-600 text-center mb-2">
          💖 ポジティブ決算 AI 💖
        </h1>
        <p className="text-sm text-gray-500 text-center mb-6">
          どんな失敗も資産に変える！ハッピー会計システム✨
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">
              今日あった出来事・愚痴を入力してね！
            </label>
            <textarea
              className="w-full p-3 border-2 border-pink-200 rounded-xl focus:outline-none focus:border-pink-500 text-gray-800"
              rows={3}
              placeholder="例：今日もお仕事頑張りすぎて疲れちゃった😭"
              value={eventText}
              onChange={(e) => setEventText(e.target.value)}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-pink-500 hover:bg-pink-600 text-white font-bold rounded-xl shadow-lg transform transition active:scale-95 disabled:opacity-50"
          >
            {loading ? 'AIが爆速仕訳中…✨' : 'ポジティブ仕訳を生成！🚀'}
          </button>
        </form>

        {result && (
          <div className="mt-6 p-4 bg-pink-100 rounded-xl border border-pink-300 animate-fade-in">
            <h2 className="text-lg font-bold text-pink-700 mb-2">🎉 決算仕訳完了！</h2>
            <div className="space-y-1 text-sm text-gray-800">
              <p><strong>勘定科目:</strong> {result.data?.category || result.journal_entry?.category || '自己投資費'}</p>
              <p><strong>金額:</strong> ¥{(result.data?.amount || result.journal_entry?.amount || 0).toLocaleString()}</p>
              <p><strong>借方 / 貸方:</strong> {result.data?.debit_account || result.journal_entry?.debit_account} / {result.data?.credit_account || result.journal_entry?.credit_account}</p>
              <p className="mt-2 text-pink-600 font-semibold">
                💬 {result.data?.positive_comment || result.journal_entry?.positive_comment || result.message}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* 集計ダッシュボードカード */}
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-6 border-4 border-purple-200">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-purple-600">📊 2026年10月 決算サマリー</h2>
          <button
            onClick={fetchSummary}
            disabled={summaryLoading}
            className="px-3 py-1 bg-purple-500 hover:bg-purple-600 text-white text-sm font-bold rounded-lg shadow transition disabled:opacity-50"
          >
            {summaryLoading ? '集計中…' : '最新集計を取得✨'}
          </button>
        </div>

        {summaryData && (
          <div className="space-y-3 text-sm text-gray-700">
            <div className="p-3 bg-purple-50 rounded-xl border border-purple-200 flex justify-between items-center">
              <span className="font-semibold text-purple-800">総取引件数</span>
              <span className="text-lg font-extrabold text-purple-600">{summaryData.total_transactions} 件</span>
            </div>
            <div className="p-3 bg-purple-50 rounded-xl border border-purple-200 flex justify-between items-center">
              <span className="font-semibold text-purple-800">ハッピー総資産額</span>
              <span className="text-lg font-extrabold text-purple-600">¥{summaryData.total_asset_value?.toLocaleString()}</span>
            </div>

            {/* カテゴリ別内訳 */}
            {summaryData.category_breakdown && (
              <div className="mt-3">
                <p className="font-bold text-gray-600 mb-1">🏷️ カテゴリ別内訳</p>
                <div className="bg-gray-50 p-3 rounded-xl space-y-1">
                  {Object.entries(summaryData.category_breakdown).map(([cat, amt]: [string, any]) => (
                    <div key={cat} className="flex justify-between text-xs">
                      <span className="text-gray-600">{cat}</span>
                      <span className="font-bold text-gray-800">¥{amt.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
