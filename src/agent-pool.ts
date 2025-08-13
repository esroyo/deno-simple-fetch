import { createPool } from 'generic-pool';

import { Agent, AgentPool, AgentPoolOptions, SendOptions } from './types.ts';
import { createAgent } from './agent.ts';

const defaultEvictionInterval = 10_000;
const defaultMax = Number.MAX_SAFE_INTEGER;
const defaultIdleTimeout = 30_000;

export function createAgentPool(
    baseUrl: URL,
    options: AgentPoolOptions = {},
): AgentPool {
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

    if (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') {
        throw new Error(
            `Unsupported protocol: ${baseUrl.protocol}. Only http: and https: are supported.`,
        );
    }
    const poolOptions = {
        autostart: false,
        evictionRunIntervalMillis,
        softIdleTimeoutMillis,
        max,
        min,
    };
    const pool = createPool<Agent>({
        async create() {
            return createAgent(baseUrl);
        },
        async destroy(agent) {
            agent.close();
        },
    }, poolOptions);

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
            await releaseAgentFn(true);
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
        hostname: baseUrl.hostname,
        port: baseUrl.port
            ? parseInt(baseUrl.port)
            : (baseUrl.protocol === 'https:' ? 443 : 80),
        send,
    };
}
