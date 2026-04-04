import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { Inter } from "next/font/google";

import { Sidebar } from "@/components/sidebar";
import { Topbar, User } from "@/components/top-bar";
import { Toaster } from "sonner";

import { ThemeProvider } from "@/components/theme-provider";
import { MultiSelectProvider } from "@/contexts/multi-select-context";
import { PlayersProvider } from "@/contexts/players-context";
import { PreferencesProvider } from "@/contexts/preferences-context";

import ErrorBoundary from "@/components/error-boundary";
import { useRouter } from "next/router";
import { useEffect } from "react";
import useSWR from "swr";

const inter = Inter({ subsets: ["latin"] });

export default function App({ Component, pageProps }: AppProps) {
	const router = useRouter();

	// In dev mode, accept ?_uid=<value> in the URL to adopt the UID that was
	// assigned when the sync script imported a save file server-side.  This
	// lets the browser see the same player data without any manual steps.
	useEffect(() => {
		if (!parseInt(process.env.NEXT_PUBLIC_DEVELOPMENT ?? "0")) return;
		const _uid = router.query._uid as string | undefined;
		if (!_uid) return;

		const expires = new Date();
		expires.setFullYear(expires.getFullYear() + 1);
		// SameSite=Strict prevents CSRF; Secure is intentionally omitted because
		// this only runs in the local dev environment (HTTP localhost).
		document.cookie = `uid=${_uid}; SameSite=Strict; path=/; expires=${expires.toUTCString()}`;

		// Remove _uid from the URL without triggering a full navigation.
		// router.replace and router.pathname are stable refs – only _uid triggers this.
		const { _uid: _removed, ...rest } = router.query;
		router.replace(
			{ pathname: router.pathname, query: rest },
			undefined,
			{ shallow: true },
		);
	}, [router.query._uid]); // eslint-disable-line react-hooks/exhaustive-deps

	const api = useSWR<User>(
		"/api",
		// @ts-expect-error
		(...args) => fetch(...args).then((res) => res.json()),
		{ refreshInterval: 0, revalidateOnFocus: false },
	);

	return (
		<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
			<PlayersProvider>
				<PreferencesProvider>
					<MultiSelectProvider>
						<div className={`${inter.className}`}>
							<div className="sticky top-0 z-10 dark:bg-neutral-950">
								<Topbar />
							</div>
							<div>
								<Sidebar className="hidden max-h-[calc(100vh-65px)] min-h-[calc(100vh-65px)] overflow-y-auto overflow-x-clip md:fixed md:flex md:w-72 md:flex-col" />
								<div className="md:pl-72">
									<ErrorBoundary>
										<Component {...pageProps} />
									</ErrorBoundary>
									<Toaster richColors />
								</div>
							</div>
						</div>
					</MultiSelectProvider>
				</PreferencesProvider>
			</PlayersProvider>
		</ThemeProvider>
	);
}
