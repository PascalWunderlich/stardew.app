import { deleteCookie } from "cookies-next";

/**
 * Clears all auth-related cookies and redirects to the home page.
 * Used by both the desktop top-bar and the mobile navigation drawer.
 */
export function logoutUser() {
	const domain = parseInt(process.env.NEXT_PUBLIC_DEVELOPMENT!)
		? "localhost"
		: "stardew.app";

	deleteCookie("token", { maxAge: 0, domain });
	deleteCookie("uid", { maxAge: 0, domain });
	deleteCookie("oauth_state", { maxAge: 0, domain });
	deleteCookie("discord_user", { maxAge: 0, domain });

	window.location.href = "/";
}
