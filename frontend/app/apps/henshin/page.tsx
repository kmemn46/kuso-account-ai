'use client';

import { getAccessToken } from '@/lib/auth';
import { Authenticator } from '@aws-amplify/ui-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

// Lambda関数URL
const API_BASE_URL = process.env.NEXT_PUBLIC_HENSHIN_LAMBDA_URL;

export default function HenshinPage() {
    const [subject, setSubject] = useState('猫');
    const [narration, setNarration] = useState<string>('');
    const [queue, setQueue] = useState<string[]>([]);

    // ★ 画像とローディング状態を管理するリスト
    // status: 'loading'（生成中） または 'completed'（完了）
    const [images, setImages] = useState<{ prompt: string; url?: string; status: 'loading' | 'completed' }[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(false);

    // テキストエリアのDOM要素を参照するためのref
    const scrollRef = useRef<HTMLDivElement>(null);

    // 1文字ずつ画面に表示していくタイピング用のループ処理
    useEffect(() => {
        if (queue.length === 0) return;

        // 表示スピード（ミリ秒単位。数字を小さくすると速くなります）
        const timer = setTimeout(() => {
            const nextChar = queue[0];
            setNarration((prev) => prev + nextChar);
            setQueue((q) => q.slice(1)); // 処理した1文字をリストから削除
        }, 30);
        return () => clearTimeout(timer);
    }, [queue]);

    // 文字（narration）が更新されるたびに、一番下にスクロールさせる
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [narration]);

    // 「変身」ボタンが押されたときの処理
    const handleHenshin = async () => {
        setIsLoading(true);
        setNarration('');
        setQueue([]);
        setImages([]); // 前回の画像をクリア

        // 変身開始と同時に、第1段階の「画像生成中ローディング枠」をあらかじめ用意する
        setImages([{ prompt: '第1段階 覚醒中...', status: 'loading' }]);

        try {
            // ログインセッションからトークン(JWT)を取得する
            const token = await getAccessToken();

            if (!token) {
                alert('アクセストークンが見つかりません。ログインしてください。');
                return;
            }

            // fetchを使ってLambda関数URLへリクエスト送信
            const response = await fetch(`${API_BASE_URL}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({ subject }),
            });

            if (!response.ok || !response.body) {
                throw new Error('変身に失敗しました（通信エラーまたは認証エラー）');
            }

            // ストリームデータ（ReadableStream）をリアルタイムに読み込む
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                // 受け取ったチャンクを文字列にデコード
                buffer += decoder.decode(value, { stream: true });

                // 改行区切りで送られてくるJSONを1行ずつ処理して画面に反映
                const lines = buffer.split('\n');
                // 最後の要素は途中で切れている可能性があるためバッファに残す
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.trim()) continue;

                    try {
                        const parsed = JSON.parse(line);
                        // データのタイプによって処理を分岐
                        if (parsed.type === 'text') {

                            // テキストの場合、現在のナレーションに追加していく
                            // 届いたテキストの断片を1文字ずつバラしてキュー（リスト）に追加する
                            const chars = parsed.content.split('');
                            setQueue((q) => [...q, ...chars]);

                        } else if (parsed.type === 'image_result') {

                            // 画像生成完了データを受け取った場合
                            console.log("画像生成完了データ受信:", parsed);
                            
                            if (parsed.data) {
                                const imageUrl = `data:image/jpeg;base64,${parsed.data}`;
                                setImages((prev) => {
                                    const newImages = [...prev];
                                    const loadingIndex = newImages.findIndex((img) => img.status === 'loading');

                                    if (loadingIndex !== -1) {
                                        newImages[loadingIndex] = { prompt: parsed.prompt, url: imageUrl, status: 'completed' };
                                    } else {
                                        newImages.push({ prompt: parsed.prompt, url: imageUrl, status: 'completed' });
                                    }

                                    // まだ3段階に達しておらず、かつ次のローディング枠がなければ追加する
                                    const completedCount = newImages.filter((img) => img.status === 'completed').length;
                                    const hasLoading = newImages.some((img) => img.status === 'loading');

                                    if (completedCount < 3 && !hasLoading) {
                                        newImages.push({ prompt: `第 ${completedCount + 1} 段階 覚醒中...`, status: 'loading' });
                                    }
                                    return newImages;
                                });

                            } else {
                                console.error("画像データ(data)がundefinedです！", parsed);
                            }

                        } else if (parsed.type === 'error') {
                            console.error("サーバー側エラー:", parsed.message);
                        }
                    } catch (e) {
                        console.error('JSON Parse Error:', e, 'Line:', line);
                    }
                }
            }
        } catch (error) {
            console.error(error);
            setNarration((prev) => prev + '\n【エラー】変身システムが暴走しました…！認証や通信を確認してください。');
        } finally {
            setIsLoading(false);
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

            {/* メインカード */}
             <Authenticator>
                {({ signOut, user }) => (

                    <div className="bg-white border border-gray-200 rounded-2xl p-8 sm:p-10 shadow-lg text-center">
                        <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-4">
                            🔥 特撮変身アトラクション 🔥
                        </h2>

                        {/* ★ お題入力エリア */}
                        <div className="mb-4">
                            <input
                                name="subject"
                                type="text"
                                value={subject}
                                onChange={(e) => setSubject(e.target.value)}
                                disabled={isLoading}
                                className="w-full p-2 bg-gray-800 border border-gray-700 rounded text-white"
                            />
                        </div>

                        <button
                            onClick={handleHenshin}
                            disabled={isLoading}
                            className={`px-8 py-4 text-lg font-bold text-white rounded-xl shadow-md transition-all duration-200 ${
                            isLoading
                                ? 'bg-gray-500 cursor-not-allowed'
                                : 'bg-orange-600 hover:bg-orange-700 active:scale-95 shadow-orange-500/30'
                            }`}
                        >
                        {isLoading ? '蒸着プロセス展開中...' : '蒸着！'}
                        </button>

                        {/* ローディング付き画像表示エリア */}
                        <div className="mt-6 space-y-4">
                            {images.map((img, index) => (
                                <div key={index} className="p-4 bg-gray-800 rounded border border-gray-700 text-center animate-fade-in">
                                    <p className="text-xs text-yellow-400 font-bold mb-2">【ステップ {index + 1} 覚醒イラスト】</p>
                                    {img.status === 'loading' ? (
                                        /* ★ 画像生成中のローディング演出（スピナーとテキスト） */
                                        <div className="flex flex-col items-center justify-center h-[200px] space-y-3">
                                            <div className="w-10 h-10 border-4 border-red-500 border-t-transparent rounded-full animate-spin"></div>
                                            <p className="text-sm text-gray-400 animate-pulse">AIが変身イラストを召喚中...</p>
                                        </div>
                                        ) : (
                                        /* 生成完了後の画像表示 */
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img 
                                            src={img.url} 
                                            alt={img.prompt} 
                                            className="rounded-lg shadow-lg max-w-[250px] mx-auto"
                                        />
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* ナレーションがリアルタイムで流れるコンソール風ウィンドウ */}
                        <div ref={scrollRef} className="mt-4 p-4 bg-gray-900 text-green-400 font-mono rounded whitespace-pre-wrap h-[180px] overflow-y-auto text-left">
                            {narration || '「蒸着！」ボタンを押すと、ナレーションがストリーミング再生されます...'}
                            <span className="animate-pulse">_</span> {/* カーソル点滅演出 */}
                        </div>
                    </div>
                )}
            </Authenticator>

            {/* フッター */}
            <footer className="text-gray-400 text-sm">
                クソアプリ・テーマパーク - アトラクション #02
            </footer>
        </main>
    );

}