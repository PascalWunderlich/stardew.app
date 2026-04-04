import { NextApiRequest, NextApiResponse } from "next";
import { verifyTurnstile } from "./_lib/turnstile";

async function post(req: NextApiRequest, res: NextApiResponse) {
	const body = req.body;
	const ip =
		(req.headers["x-forwarded-for"] as string) ??
		req.socket.remoteAddress ??
		null;

	const outcome = await verifyTurnstile(body.turnstile, ip);

	if (!outcome.success) {
		return res.status(400).end();
	}

	const linearResponse = await fetch("https://api.linear.app/graphql", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"Authorization": `${process.env.LINEAR_API_KEY}`,
		},
		body: JSON.stringify({
			query: `mutation IssueCreate{
      issueCreate(
        input: {
          title: "${body.short}",
          description: "**Reported by:** ${body.user.discord_name} (${body.user.discord_id})\\n\\n${body.long}\\n\\nIP: ${ip}",
          teamId: "${process.env.LINEAR_TEAM_ID}",
          labelIds: ["${process.env.LINEAR_BUG_LABEL}"]
        }
      ) {
        success
        issue {
          id
          identifier
          title
        }
      }
    }`,
			variables: {},
		}),
	});

	const parsedLinearResponse = await linearResponse.json();
	const identifier = parsedLinearResponse.data.issueCreate.issue.identifier;

	if (!linearResponse.ok) {
		throw new Error("Failed to create issue in Linear");
	}

	const result = await fetch(process.env.FEEDBACK_WEBHOOK as string, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			content: null,
			embeds: [
				{
					title: `<a:sdvUh:1220462519466852493> New bug report! (${identifier})`,
					url: `https://linear.app/stardew/issue/${identifier}`,
					color: null,
					fields: [
						{
							name: "What happened?",
							value: `${body.short}`,
						},
						{
							name: "What were you doing when this happened?",
							value: `${body.long}`,
						},
					],
					author: {
						name: `${body.user.discord_name} (${body.user.discord_id})`,
						url: "https://cdn.discordapp.com/embed/avatars/0.png",
					},
					footer: {
						text: `Turnstile: ${outcome.challenge_ts} | IP: ${ip}`,
					},
				},
			],
			attachments: [],
		}),
	});

	return res.json({ identifier: identifier });
}

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse,
) {
	try {
		switch (req.method) {
			case "POST":
				return await post(req, res);
		}
		res.status(405).end();
	} catch (e: any) {
		res.send(e.message);
	}
}
