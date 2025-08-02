import { createPool } from 'generic-pool';

import { Agent, AgentPool, AgentPoolOptions, SendOptions } from './types.ts';
import { createAgent } from './agent.ts';

const defaultEvictionInterval = 10_000;
const defaultMax = Number.MAX_SAFE_INTEGER;
const defaultIdleTimeout = 30_000;

export function createAgentPool(
    baseUrl: string,
    options: AgentPoolOptions = {},
): AgentPool {
    const poolUrl = new URL(baseUrl);

    const evictionRunIntervalMillis = options.poolIdleTimeout !== false
        ? Math.min(
            options.poolIdleTimeout || defaultEvictionInterval,
            defaultEvictionInterval,
        )
        : 0;
    const max = options.poolMaxPerHost
        ? Math.max(1, options.poolMaxPerHost)
        : defaultMax;
    const softIdleTimeoutMillis = options.poolIdleTimeout !== false
        ? Math.max(1, options.poolIdleTimeout || defaultIdleTimeout)
        : -1;
    const min = softIdleTimeoutMillis > 0 && options.poolMaxIdlePerHost
        ? Math.max(0, options.poolMaxIdlePerHost)
        : 0;

    if (poolUrl.protocol !== 'http:' && poolUrl.protocol !== 'https:') {
        throw new Error(
            `Unsupported protocol: ${poolUrl.protocol}. Only http: and https: are supported.`,
        );
    }

    const pool = createPool<Agent>({
        async create() {
            return createAgent(baseUrl);
        },
        async destroy(agent) {
            agent.close();
        },
    }, {
        autostart: false,
        evictionRunIntervalMillis,
        softIdleTimeoutMillis,
        max,
        min,
    });

    let releaseAgentFns: Array<(forceClose?: boolean) => Promise<void>> = [];

    async function send(
        sendOptions: SendOptions,
    ): Promise<Response> {
        let agent: Agent | undefined;
        let agentReleased = false;
        const releaseAgentFn = async (forceClose = false) => {
            if (!agent || agentReleased) {
                return;
            }
            agentReleased = true;
            releaseAgentFns = releaseAgentFns.filter((r) =>
                r !== releaseAgentFn
            );
            if (forceClose) {
                agent.close();
            }
            if (pool.isBorrowedResource(agent)) {
                await pool.release(agent);
            }
        };
        releaseAgentFns.push(releaseAgentFn);
        try {
            agent = await pool.acquire();
            const responsePromise = agent.send(sendOptions);
            agent.whenIdle().then(() => releaseAgentFn());
            return responsePromise;
        } catch (error) {
            await releaseAgentFn();
            throw error;
        }
    }

    async function close() {
        await Promise.all(releaseAgentFns.map((release) => release(true)));
        await pool.drain();
        await pool.clear();
    }

    return {
        [Symbol.asyncDispose]: close,
        close,
        hostname: poolUrl.hostname,
        port: poolUrl.port
            ? parseInt(poolUrl.port)
            : (poolUrl.protocol === 'https:' ? 443 : 80),
        send,
    };
}
