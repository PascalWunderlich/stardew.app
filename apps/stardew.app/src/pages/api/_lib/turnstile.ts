type TurnstileSuccess = {
	"success": true;
	"challenge_ts": string;
	"hostname": string;
	"error-codes": string[];
	"action": string;
	"cdata": string;
};

type TurnstileFailure = {
	"success": false;
	"error-codes": [string, ...string[]];
};

export type TurnstileResult = TurnstileSuccess | TurnstileFailure;

export async function verifyTurnstile(
	token: string,
	ip: string | null,
): Promise<TurnstileResult> {
	const formData = new URLSearchParams();

	formData.append("secret", process.env.TURNSTILE_KEY as string);
	formData.append("response", token);

	if (ip) {
		formData.append("remoteip", ip);
	}

	const url = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

	const result = await fetch(url, {
		body: formData,
		method: "POST",
	});

	return result.json() as Promise<TurnstileResult>;
}

export function codeblock(code: string, lang = "ts") {
	return `\`\`\`${lang}
${code}
\`\`\``;
}
