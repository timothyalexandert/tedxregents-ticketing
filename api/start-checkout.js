import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({
            success: false,
            error: "Method not allowed."
        });
    }

    try {
        console.log("STEP 1: API reached");

        console.log("STEP 2: About to write Redis");

        await redis.set(
            "tedx:test:connection",
            "connection works",
            { ex: 60 }
        );

        console.log("STEP 3: Redis write succeeded");

        const value =
            await redis.get(
                "tedx:test:connection"
            );

        console.log(
            "STEP 4: Redis read succeeded:",
            value
        );

        return res.status(200).json({
            success: true,
            message: "Redis connection works!",
            value
        });

    } catch (error) {

        console.error(
            "REDIS TEST ERROR:",
            error
        );

        return res.status(500).json({
            success: false,
            error: String(error)
        });
    }
}
