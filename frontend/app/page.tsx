'use client';

import Link from "next/link";

// パークに並ぶクソアプリのデータ型とリスト
interface KusoApp {
    id: string;
    title: string;
    description: string;
    emoji: string;
    path: string;
}

const kusoApps: KusoApp[] = [
    {
        id: 'app-1',
        title: 'ポジティブ決算 AI',
        description: '愚痴や課題を入力すると、AIが無理やりポジティブ（？）な仕訳データへ変換します。ギャルの一言コメント付き。',
        emoji: '🧾',
        path: '/apps/positive',
    },
    {
        id: 'app-2',
        title: '企画検討中・・・',
        description: '',
        emoji: '🏃‍♂️',
        path: '/apps/excuse',
    },
    {
        id: 'app-3',
        title: '企画検討中・・・',
        description: '',
        emoji: '⏳',
        path: '/apps/nothing',
    },
];

export default function ThemeParkHome() {
    return (
        <main className="min-h-screen bg-gradient-to-b from-purple-900 via-indigo-900 to-black text-white p-8">
            {/* ヘッダー部分 */}
            <div className="max-w-4xl mx-auto text-center py-12">
                <h1 className="text-5xl font-extrabold mb-4 tracking-wider text-yellow-300 drop-shadow-lg">
                    🎢 クソアプリ・テーマパーク 🎡
                </h1>
                <p className="text-lg text-gray-300">
                    ようこそ！ここでは役に立つかどうかもわからない（？）、シュールなアプリたちを楽しめます。
                </p>
            </div>
            {/* アプリ一覧カードグリッド */}
            <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6">
                { kusoApps.map((app) => (
                    <div
                    key={app.id}
                    className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-6 shadow-xl hover:scale-105 transition-transform duration-300 flex flex-col justify-between">
                        <div>
                            <div className="text-4xl mb-4">{app.emoji}</div>
                            <h2 className="text-2xl font-bold mb-2 text-yellow-200">{app.title}</h2>
                            <p className="text-gray-300 text-sm mb-6">{app.description}</p>
                        </div>
                        <Link href={app.path} prefetch={false} className="inline-block text-center bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-bold py-2 px-4 rounded-xl transition-colors duration-200 shadow-md">
                            遊んでみる 🚀
                        </Link>
                    </div>
                ))}
            </div>
        </main>
    );
}

