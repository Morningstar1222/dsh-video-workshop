/**
 * 支教知识视频工坊 —— 宿主侧入口。
 *
 * 只做两件事：注册 HTTP API（客户端全部走 fetch 调用），
 * 以及把 AI 能力间接暴露给客户端（客户端拿不到 llm 服务）。
 */

import { installApi } from './lib/api.js'

export const name = 'video-workshop'

/** 声明依赖：webServer 提供路由，workingDirectory 提供工作区兜底路径。 */
export const inject = ['webServer', 'workingDirectory']

export function apply(ctx) {
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => installApi(webCtx))
  })
}
