"use client";

import MarkdownRenderer from "@/components/MarkdownRenderer";
import Spinner from "@/components/Spinner";
import { getAccessToken } from '@/lib/auth';
import { useEffect, useRef, useState } from "react";

// Lambda関数URL
const CHAT_LAMBDA_HTTP_URL = process.env.NEXT_PUBLIC_API_URL;
const CHAT_LAMBDA_CLOUDFRONT_URL = process.env.NEXT_PUBLIC_CHAT_LAMBDA_CLOUDFRONT_URL;

// 文字列のSHA-256ハッシュ（16進数文字列）を計算する関数
async function calculateSha256(message: string) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
}

interface Session {
    sessionId: string;
    title: string;
    updatedAt?: string;
}

interface Message {
    role: string;
    content: string;
}

export default function ChatPage() {

    const [sessions, setSessions] = useState<Session[]>([]);         // セッション一覧の状態
    const [currentSessionId, setCurrentSessionId] = useState<string>("");
    const [userMessage, setUserMessage] = useState("");
    const [messages, setMessages] = useState<Message[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(false);
    const [isLoadingSessions, setIsLoadingSessions] = useState<boolean>(true);

    // サイドバーの開閉状態（PC用・スマホ用）
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    // 削除確認モーダルの開閉管理用ステート
    const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

    const messagesEndRef = useRef<HTMLDivElement>(null);

    // messages（会話履歴）が更新されるたびに、自動で一番下にスクロールする関数
    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    // ==========================================
    // 初期表示時：セッション一覧をAPIから取得する
    // ==========================================
    useEffect(() => {
        const fetchSessions = async () => {

            try {
                setIsLoadingSessions(true); // 読み込み開始
                const accessToken = await getAccessToken();

                if (!accessToken) {
                    alert('アクセストークンが見つかりません。ログインしてください。');
                    return;
                }

                const response = await fetch(`${CHAT_LAMBDA_HTTP_URL}/sessions`, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                    },
                });

                if (!response.ok) throw new Error("セッション一覧の取得に失敗しました。");

                const data = await response.json();

                if (data.sessions && data.sessions.length > 0) {
                    const sortedSessions = sortSessionsByDate(data.sessions);
                    setSessions(sortedSessions);

                    // 最初は一番上のセッションを選択し、その履歴を自動で読み込む
                    setCurrentSessionId(data.sessions[0].sessionId);
                    fetchChatHistory(data.sessions[0].sessionId, accessToken);
                }
            } catch (error) {
                console.error("セッション一覧のロード中にエラーが発生しました:", error);
            } finally {
                setIsLoadingSessions(false); // 読み込み終了
            }
        };
        fetchSessions();
    }, []);

    // ==========================================
    // セッション一覧を新しい順（降順）に並び替えるヘルパー関数
    // ==========================================
    const sortSessionsByDate = (sessionList: Session[]) => {
        return [...sessionList].sort((a, b) => {
            const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
            const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
            return timeB - timeA; // 新しい日時が上にくるように計算
        });
    };

    // ==========================================
    // 選択したセッションの会話履歴をAPIから取得して復元する
    // ==========================================
    const fetchChatHistory = async (targetSessionId: string, token?: string) => {
        try {
            setIsLoadingHistory(true);
            const accessToken = token || await getAccessToken();

            if (!accessToken) {
                alert('アクセストークンが見つかりません。ログインしてください。');
                return;
            }

            // 履歴取得APIへのリクエスト
            const response = await fetch(`${CHAT_LAMBDA_HTTP_URL}/history?sessionId=${targetSessionId}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                },
            });

            if (!response.ok) throw new Error("会話履歴の取得に失敗しました。");

            const data = await response.json();
            setMessages(data.messages || []);

        } catch (error) {
            console.error("履歴のロード中にエラーが発生しました:", error);
            setMessages([]); // エラー時は空にする
        } finally {
            setIsLoadingHistory(false);
        }
    }

    // ==========================================
    // 新しいチャットを作成する
    // ==========================================
    const handleNewChat = () => {
        const newId = `session-${crypto.randomUUID()}`;
        const newSession = {
            sessionId: newId,
            title: "新しいチャット",
            updatedAt: new Date().toISOString() // 現在の日時を付与
        };

        setSessions((prev) => sortSessionsByDate([newSession, ...prev]));
        setCurrentSessionId(newId);
        setMessages([]); // 画面のメッセージをリセット
        setIsMobileMenuOpen(false); // スマホで新規作成したらメニューを閉じる
    }

    // ==========================================
    // セッションを削除する
    // ==========================================
    const handleDeleteSession = async (e: React.MouseEvent, targetSessionId: string) => {

        try {

            const accessToken = await getAccessToken();
            if (!accessToken) {
                alert('アクセストークンが見つかりません。ログインしてください。');
                return;
            }

            const response = await fetch(`${CHAT_LAMBDA_HTTP_URL}/delete?sessionId=${targetSessionId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                },
            });

            if (!response.ok) throw new Error("セッションの削除に失敗しました。");

            // 画面のステート（sessions）から、削除されたセッションを除外する
            setSessions((prev) => prev.filter((s) => s.sessionId !== targetSessionId));

            // もし現在開いていたチャットを削除した場合は、メッセージをクリアする
            if (currentSessionId === targetSessionId) {
                setMessages([]);
                setCurrentSessionId("");
            }

        } catch (error) {
            console.error("削除中にエラーが発生しました:", error);
        }
    }


    // ==========================================
    // メッセージ送信とストリーミング受信
    // ==========================================
    const handleSend = async () => {
        if (!userMessage.trim() || isLoading) return;

        // セッションが選択されていない（初期状態などの）場合、自動で新しいセッションを作成する
        let activeSessionId = currentSessionId;
        if (!activeSessionId) {
            const newId = `session-${crypto.randomUUID()}`;
            const newTitle = userMessage.slice(0, 20) + (userMessage.length > 20 ? "..." : ""); // 最初の20文字をタイトルにする
            const newSession = { sessionId: newId, title: newTitle };

            setSessions((prev) => [newSession, ...prev]);
            setCurrentSessionId(newId);
            activeSessionId = newId;
        }

        const currentMessage = userMessage;
        setUserMessage("");
        setIsLoading(true);

        // 画面のメッセージ一覧に自分の発言と、AIの空の返答（思考中...用）を追加する
        setMessages((prev) => [
            ...prev,
            { role: "user", content: currentMessage },
            { role: "assistant", content: "" }
        ]);

        try {

            const accessToken = await getAccessToken();
            if (!accessToken) {
                alert('アクセストークンが見つかりません。ログインしてください。');
                return;
            }

            // 送信するJSONデータを作成
            const bodyString = JSON.stringify({ sessionId: activeSessionId, userMessage: currentMessage });

            // リクエストボディのSHA-256ハッシュを計算する
            const contentSha256 = await calculateSha256(bodyString);

            // Lambda関数URLへのリクエスト
            const response = await fetch(`${CHAT_LAMBDA_CLOUDFRONT_URL}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    'x-amz-content-sha256': contentSha256,
                    'X-User-Token': `Bearer ${accessToken}`,  // Authorization ではなく専用のカスタムヘッダーにする
                },
                body: bodyString,
            });

            if (!response.ok || !response.body) throw new Error("ストリーミング接続に失敗しました。");

            // ReadableStream を使って SSE データをチャンクごとに読み込む
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let assistantResponse = "";

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                // 受け取ったバイナリをテキストにデコード
                const chunkValue = decoder.decode(value, { stream: true });

                // SSE形式（data: ...\n\n）の行ごとに分割して処理する
                const lines = chunkValue.split("\n");

                for (const line of lines) {
                    if (line.startsWith("data: ")) {
                        const jsonString = line.replace("data: ", "").trim();

                        // 終了合図 [DONE] の場合はループを抜ける
                        if (jsonString === "[DONE]") break;

                        try {
                            const parsed = JSON.parse(jsonString);
                            if (parsed.text) {
                                assistantResponse += parsed.text;

                                // 画面上のAIの回答部分をリアルタイムに更新する
                                setMessages((prev) => {
                                    const newMessages = [...prev];
                                    newMessages[newMessages.length - 1] = {
                                        role: "assistant",
                                        content: assistantResponse,
                                    };
                                    return newMessages;
                                });
                            }
                        } catch (e) {
                            // JSONパースエラーは無視（不完全なチャンクの考慮）
                        }
                    }
                }
            }

            setSessions((prevSessions) => {
                // 該当するセッションの updatedAt を今の時刻に更新する
                const updatedList = prevSessions.map((session) => {
                    if (session.sessionId === activeSessionId) {
                        return { ...session, updatedAt: new Date().toISOString() };
                    }
                    return session;
                });
                return sortSessionsByDate(updatedList);
            });

        } catch (error) {
            console.error("エラーが発生しました:", error);
        } finally {
            setIsLoading(false);
        }
    };

    // サイドバー内のセッション一覧を描画する共通パーツ
    const renderSessionList = (isMobile = false) => (
        <div className="flex-1 overflow-y-auto flex flex-col gap-1.5 w-full pr-1">
            <div className="text-xs font-semibold text-white/40 px-2 mb-1">会話履歴</div>
            {isLoadingSessions ? (
                <div className="flex justify-center items-center py-8">
                    <Spinner size="md" />
                </div>
            ) : (
                sessions.map((session) => (
                    <div
                        key={session.sessionId}
                        onClick={() => {
                            setCurrentSessionId(session.sessionId);
                            fetchChatHistory(session.sessionId);
                            if (isMobile) setIsMobileMenuOpen(false); // スマホ時は選択したらメニューを閉じる
                        }}
                        className={`w-full group text-left py-2.5 rounded-xl text-sm transition flex items-center justify-between cursor-pointer ${isSidebarOpen || isMobile ? "px-3" : "px-2 justify-center"
                            } ${currentSessionId === session.sessionId
                                ? "bg-white/20 text-white font-medium border border-white/15"
                                : "text-white/70 hover:bg-white/10 hover:text-white"
                            }`}
                        title={session.title}
                    >
                        <span className="truncate flex-1">
                            {isSidebarOpen || isMobile ? session.title : "💬"}
                        </span>

                        {(isSidebarOpen || isMobile) && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setDeleteTargetId(session.sessionId);
                                }}
                                className="opacity-0 group-hover:opacity-100 text-white/50 hover:text-red-400 p-1 transition rounded"
                                title="削除"
                            >
                                🗑️
                            </button>
                        )}
                    </div>
                ))
            )}
        </div>
    );

    return (
        <div className="min-h-screen bg-gradient-to-b from-purple-900 via-indigo-900 to-black text-white flex overflow-hidden relative">

            {/* ================= PC用サイドバー ================= */}
            <aside
                className={`hidden md:flex bg-black/50 backdrop-blur-md border-r border-white/10 flex-col p-4 shrink-0 transition-all duration-300 ease-in-out ${isSidebarOpen ? "w-72" : "w-20 items-center"
                    }`}
            >
                <div className={`flex items-center mb-4 w-full ${isSidebarOpen ? "justify-between" : "justify-center"}`}>
                    {isSidebarOpen && <span className="text-sm font-bold tracking-wider text-white/80">Menu</span>}
                    <button
                        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                        className="bg-white/10 hover:bg-white/20 border border-white/10 p-2.5 rounded-xl text-white transition flex items-center justify-center"
                        title="サイドバーの開閉"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                        </svg>
                    </button>
                </div>
                {/* ホームに戻るボタン（PC用） */}
                <div className="mb-3 w-full">
                    <a
                        href="/"
                        className={`text-xs text-white/70 hover:text-white bg-white/10 hover:bg-white/25 py-2.5 rounded-xl backdrop-blur-md border border-white/10 transition flex items-center justify-center gap-2 ${isSidebarOpen ? "px-3 justify-start" : "w-full justify-center"
                            }`}
                        title="ホームに戻る"
                    >
                        <span className="text-base">🏠</span>
                        {isSidebarOpen && <span>パーク入り口に戻る</span>}
                    </a>
                </div>

                <button
                    onClick={handleNewChat}
                    className={`bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-medium py-2.5 rounded-xl shadow-lg transition mb-4 text-sm flex items-center justify-center gap-2 ${isSidebarOpen ? "w-full px-4" : "w-full"
                        }`}
                    title="新しいチャット"
                >
                    <span className="text-base">✨</span>
                    {isSidebarOpen && <span>新しいチャット</span>}
                </button>

                {renderSessionList(false)}
            </aside>

            {/* ================= スマホ用サイドバー（オーバーレイ） ================= */}
            {isMobileMenuOpen && (
                <div className="fixed inset-0 z-50 flex md:hidden">
                    <div
                        className="fixed inset-0 bg-black/70 backdrop-blur-sm"
                        onClick={() => setIsMobileMenuOpen(false)}
                    />
                    <div className="relative w-72 bg-black/90 border-r border-white/10 flex flex-col p-4 z-10 h-full">
                        <div className="flex items-center justify-between mb-4 w-full">
                            <span className="text-sm font-bold tracking-wider text-white/80">Menu</span>
                            <button
                                onClick={() => setIsMobileMenuOpen(false)}
                                className="bg-white/10 hover:bg-white/20 border border-white/10 p-2.5 rounded-xl text-white transition"
                            >
                                ✕
                            </button>
                        </div>

                        {/* ホームに戻るボタン（スマホ用） */}
                        <div className="mb-3 w-full">
                            <a
                                href="/"
                                className="text-xs text-white/70 hover:text-white bg-white/10 hover:bg-white/25 py-2.5 px-3 rounded-xl backdrop-blur-md border border-white/10 transition flex items-center gap-2 w-full"
                            >
                                <span className="text-base">🏠</span>
                                <span>ホームに戻る</span>
                            </a>
                        </div>

                        <button
                            onClick={handleNewChat}
                            className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-medium py-2.5 px-4 rounded-xl shadow-lg transition mb-4 text-sm flex items-center justify-center gap-2 w-full"
                        >
                            <span>✨</span>
                            <span>新しいチャット</span>
                        </button>

                        {renderSessionList(true)}
                    </div>
                </div>
            )}

            {/* ================= メイン画面エリア ================= */}
            <main className="flex-1 flex flex-col h-screen p-6 min-w-0">
                <header className="w-full max-w-4xl mx-auto mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setIsMobileMenuOpen(true)}
                            className="md:hidden bg-white/10 hover:bg-white/20 border border-white/10 p-2.5 rounded-xl text-white transition flex items-center justify-center"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                            </svg>
                        </button>
                        <h1 className="text-xl font-bold tracking-wider">AI Chat Assistant</h1>
                    </div>
                    <span className="text-xs text-white/50 bg-white/10 px-3 py-1 rounded-full hidden sm:inline-block">
                        Session: {currentSessionId}
                    </span>
                </header>

                {/* チャットメッセージ表示エリア */}
                <div className="w-full max-w-4xl mx-auto flex-1 min-h-0 bg-black/40 backdrop-blur-md border border-white/10 rounded-2xl overflow-y-auto p-6 flex flex-col gap-4 shadow-2xl">
                    {isLoadingHistory ? (
                        <div className="flex h-full items-center justify-center">
                            <Spinner size="lg" />
                        </div>
                    ) : messages.length === 0 ? (
                        <div className="flex h-full items-center justify-center text-white/50 text-sm">
                            何かメッセージを入力して会話を始めましょう！
                        </div>
                    ) : (
                        messages.map((msg, index) => (
                            <div
                                key={index}
                                className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
                            >
                                <span className="text-xs text-white/60 mb-1 px-1">
                                    {msg.role === "user" ? "You" : "AI"}
                                </span>
                                <div
                                    className={`max-w-[80%] p-4 rounded-2xl whitespace-pre-wrap text-sm leading-relaxed ${msg.role === "user"
                                        ? "bg-indigo-600 text-white rounded-br-none"
                                        : "bg-white/10 text-white/90 border border-white/10 rounded-bl-none"
                                        }`}
                                >
                                    {msg.content ? (
                                        <MarkdownRenderer content={msg.content} />
                                    ) : (
                                        <div className="flex items-center gap-2 text-white/70">
                                            <Spinner size="sm" />
                                            <span>AIが考えています...</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))
                    )
                    }
                    < div ref={messagesEndRef} />
                </div>

                {/* 入力フォームエリア */}
                <div className="w-full max-w-4xl mx-auto mt-4 flex gap-3 shrink-0">
                    <input
                        type="text"
                        value={userMessage}
                        onChange={(e) => setUserMessage(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSend()}
                        placeholder="メッセージを入力してください..."
                        disabled={isLoading}
                        className="flex-1 bg-black/50 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:border-purple-400 transition"
                    />
                    <button
                        onClick={handleSend}
                        disabled={isLoading}
                        className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 text-white px-6 py-3 rounded-xl font-medium shadow-lg transition"
                    >
                        {isLoading ? "送信中..." : "送信"}
                    </button>
                </div>
            </main >

            {/* 削除確認モーダル */}
            {deleteTargetId && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="bg-[#2d2d2d] border border-white/10 rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl text-white">
                        <h3 className="text-lg font-bold mb-2">チャットの削除</h3>
                        <p className="text-sm text-white/70 mb-6">
                            このチャット履歴を削除しますか？この操作は元に戻すことができません。
                        </p>
                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setDeleteTargetId(null)}
                                className="px-4 py-2 rounded-xl text-sm bg-white/10 hover:bg-white/20 transition text-white"
                            >
                                キャンセル
                            </button>
                            <button
                                onClick={async (e) => {
                                    if (deleteTargetId) {
                                        await handleDeleteSession(e, deleteTargetId); // 実際の削除処理
                                        setDeleteTargetId(null);
                                    }
                                }}
                                className="px-4 py-2 rounded-xl text-sm bg-red-600 hover:bg-red-500 transition text-white font-medium"
                            >
                                削除する
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div >
    );
}
