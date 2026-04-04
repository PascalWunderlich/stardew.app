import { db } from "$db";
import * as schema from "$drizzle/schema";
import { setCookie } from "cookies-next";
import crypto from "crypto";
import { NextApiRequest, NextApiResponse } from "next";

import { parseSaveFile } from "@/lib/file";

export const config = {
	api: {
		bodyParser: {
			sizeLimit: "10mb",
		},
	},
};

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse,
) {
	// Only available when running in development / local mode
	if (!parseInt(process.env.NEXT_PUBLIC_DEVELOPMENT ?? "0")) {
		return res.status(404).end();
	}

	if (req.method !== "POST") {
		return res.status(405).end();
	}

	// req.body is the raw XML string (sent as text/plain by the sync script)
	const xml =
		typeof req.body === "string"
			? req.body
			: Buffer.isBuffer(req.body)
				? req.body.toString("utf-8")
				: String(req.body ?? "");

	if (!xml.trim()) {
		return res.status(400).json({ error: "Request body is empty." });
	}

	let players: any[];
	try {
		players = parseSaveFile(xml) as any[];
	} catch (e: any) {
		return res
			.status(400)
			.json({ error: e?.message ?? "Failed to parse save file." });
	}

	// Determine UID: prefer explicit ?uid= query param (Python sync passes this
	// on subsequent runs to keep data under the same identity), then generate new.
	const uid = (req.query.uid as string)?.trim() || crypto.randomBytes(16).toString("hex");

	// Set the uid cookie in the response so a browser that follows the link
	// returned by the sync script automatically picks up the same identity.
	// Omitting 'domain' lets the browser apply it to the current origin
	// (localhost in dev), avoiding issues if the server runs on 127.0.0.1 or
	// a local network address.
	setCookie("uid", uid, {
		req,
		res,
		maxAge: 60 * 60 * 24 * 365,
	});

	// Save every parsed player to the DB (upsert).
	for (const player of players) {
		if (player._id) {
			await db
				.insert(schema.saves)
				.values({ _id: player._id, user_id: uid, ...player })
				.onDuplicateKeyUpdate({ set: player });
		}
	}

	return res.json({ uid, players: players.length });
}
