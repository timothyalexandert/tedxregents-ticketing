import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

export default async function handler(req) {
    if (req.method !== "POST") {
        return new Response(
            JSON.stringify({
                success: false,
                error: "Method not allowed."
            }),
            {
                status: 405,
                headers: {
                    "Content-Type": "application/json"
                }
            }
        );
    }

    try {
        console.log("STEP 1: API reached");

        const testKey = "tedx:test:connection";

        console.log("STEP 2: About to write Redis");

        await redis.set(
            testKey,
            "connection works",
            { ex: 60 }
        );

        console.log("STEP 3: Redis write succeeded");

        const value =
            await redis.get(testKey);

        console.log(
            "STEP 4: Redis read succeeded:",
            value
        );

        return new Response(
            JSON.stringify({
                success: true,
                message: "Redis connection works!",
                value
            }),
            {
                status: 200,
                headers: {
                    "Content-Type": "application/json"
                }
            }
        );

    } catch (error) {

        console.error(
            "REDIS TEST ERROR:",
            error
        );

        return new Response(
            JSON.stringify({
                success: false,
                error: String(error)
            }),
            {
                status: 500,
                headers: {
                    "Content-Type": "application/json"
                }
            }
        );
    }
}
