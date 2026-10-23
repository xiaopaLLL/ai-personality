/* =============================================================================
 *  AI 协作机体测试 · 题库（v2.1）
 * =============================================================================
 *  改题只改这一个文件。计分规则与上一版一致，只更新题面：
 *
 *  1. 共 16 题，4 个维度各 4 题（q01-q16），每题声明一个主维度 dim。
 *  2. 每个选项以主维度计分：
 *       +2 / +1 = 偏左（探索派 / 共情派 / 结构派 / 主导派）
 *       -2 / -1 = 偏右（交付派 / 逻辑派 / 灵感派 / 副驾派）
 *        0      = 该维暂不偏向
 *     部分选项额外带一个「语义明确的次要维度 ±1」，让相邻倾向也能被看见。
 *  3. 为避免次要分把某一维的极值撑大，每加一个次要 +1，就把该维一个 +2 选项
 *     调成 +1；每加一个次要 -1，就把该维一个 -2 选项调成 -1。
 *     因此每个维度的原始分范围仍然是 -8 ~ +8，归一化坐标仍然 x = s / 8，
 *     百分比仍然是 左侧 = round(50 + 50x)，0 分固定 50:50。
 *  4. 选项顺序（正/负/中性）已经打散，不要按固定顺序排列。
 *  5. 改完题目后把 meta.version 升个版本号（当前 v2.1）。
 * ========================================================================== */

window.SURVEY = {
  meta: {
    id: 'ai-collab-machine',
    version: 'v2.1',
    title: 'AI 协作机体测试',
    subtitle: '16 个日常协作情境，看看你和 AI 一起干活时的样子',
    estimated: '约 3 分钟',
    intro:
      '这不是心理测试，也不是能力评级。\n' +
      '16 个日常 AI 协作情境，问的是你更习惯怎么和它一起动手。\n' +
      '最后会落到 8 种协作机体中的一种——它描述的是风格，没有高低之分。\n' +
      '凭第一反应选，别想太久。',
    footerNote: '结果仅供趣味性的自我探索参考，不是心理诊断，也不代表能力高低。',
    privacyNote: '为改进测试，会匿名记录你的选项与结果类型，不收集姓名、手机号等个人信息。',
    requireConsent: true,
    askNickname: true,
    nicknamePlaceholder: '昵称（可留空）'
  },

  /* 四个维度：left = 正分那一侧，right = 负分那一侧 */
  dimensions: {
    drive: {
      label: '驱动方式',
      hint: '被新可能点燃，还是被目标结果驱动',
      left: { code: 'E', name: '探索派' },
      right: { code: 'D', name: '交付派' }
    },
    heart: {
      label: '交互偏好',
      hint: '更需要被理解，还是更需要准确',
      left: { code: 'W', name: '共情派' },
      right: { code: 'L', name: '逻辑派' }
    },
    order: {
      label: '做事方式',
      hint: '依赖流程方法，还是依赖临场灵感',
      left: { code: 'S', name: '结构派' },
      right: { code: 'I', name: '灵感派' }
    },
    role: {
      label: '协作姿态',
      hint: '习惯掌控方向，还是与 AI 随时换手',
      left: { code: 'P', name: '主导派' },
      right: { code: 'C', name: '副驾派' }
    }
  },

  questions: [
    /* ---------------- 驱动方式：探索派 + ←→ 交付派 − ---------------- */
    {
      id: 'q01',
      dim: 'drive',
      text: '朋友把一款新 AI 夸上了天。你打开后，第一件事是？',
      options: [
        { text: '把手头最烦的一件事交给它：先干点活，实力见真章。', scores: { drive: -1 } },
        { text: '照着推荐的例子试一遍，看看值不值得留下。', scores: { drive: 0 } },
        { text: '挨个翻功能，越是没见过的按钮越想点。', scores: { drive: 2, order: -1 } }
      ]
    },
    {
      id: 'q02',
      dim: 'drive',
      text: '你只想问个小问题，AI 却抛出了一个新点子。你的反应是？',
      options: [
        { text: '等等，这个有意思！原来的问题先放放。', scores: { drive: 2, heart: 1 } },
        { text: '先别跑题，把我刚才那件事解决了。', scores: { drive: -1 } },
        { text: '给你一分钟，说说这个点子到底是什么。', scores: { drive: 0 } }
      ]
    },
    {
      id: 'q03',
      dim: 'drive',
      text: '哪一刻，你最想给 AI 点个赞？',
      options: [
        { text: '聊着聊着，从“我也不知道怎么说”变成了“我懂了”。', scores: { drive: 0 } },
        { text: '它蹦出一个新点子，我当场想找点东西试试。', scores: { drive: 2, order: -1 } },
        { text: '它把一堆杂事做完，我终于能关电脑了。', scores: { drive: -1 } }
      ]
    },
    {
      id: 'q04',
      dim: 'drive',
      text: '你和 AI 忙了两周，才发现这个项目好像没那么值得做。你会？',
      options: [
        { text: '把还有用的部分收好尾，至少交出点东西。', scores: { drive: -1 } },
        { text: '换方向！新点子已经在排队了。', scores: { drive: 2, role: 1 } },
        { text: '先试个小版本，再决定是继续做还是换方向。', scores: { drive: 0 } }
      ]
    },

    /* ---------------- 交互偏好：共情派 + ←→ 逻辑派 − ---------------- */
    {
      id: 'q05',
      dim: 'heart',
      text: '你点开 AI 聊天框，第一句话更像？',
      options: [
        { text: '“我脑子有点乱，先陪我捋捋。”', scores: { heart: 1 } },
        { text: '“事情大概是这样，你看看还缺什么信息。”', scores: { heart: 0 } },
        { text: '“背景和要求都在下面，直接帮我分析。”', scores: { heart: -2, order: 1 } }
      ]
    },
    {
      id: 'q06',
      dim: 'heart',
      text: 'AI 答得很对，但说话像在发系统通知。你会？',
      options: [
        { text: '能用就行，它负责答题，不负责哄我。', scores: { heart: -1, drive: -1 } },
        { text: '答案留下，语气切回正常聊天模式。', scores: { heart: 2 } },
        { text: '自己看就算了，要转给别人就改得顺口点。', scores: { heart: 0 } }
      ]
    },
    {
      id: 'q07',
      dim: 'heart',
      text: '合作伙伴用 AI 的方法跟你很不一样，还用得挺起劲。你会？',
      options: [
        { text: '各自负责的部分先各自做，需要配合时再商量。', scores: { heart: 0 } },
        { text: '来，拿同一个任务试一轮，看哪种更好用。', scores: { heart: -2, order: 1 } },
        { text: '我先听听，你这套玩法是怎么来的？', scores: { heart: 2 } }
      ]
    },
    {
      id: 'q08',
      dim: 'heart',
      text: '什么情况下，你最容易把 AI 聊天框翻出来？',
      options: [
        { text: '想不明白，或者有点烦，想找它聊两句。', scores: { heart: 2 } },
        { text: '说不准，有时想聊聊，有时就想要个答案。', scores: { heart: 0 } },
        { text: '事情已经想好了，正缺一个帮我分析、干活的。', scores: { heart: -1, role: 1 } }
      ]
    },

    /* ---------------- 做事方式：结构派 + ←→ 灵感派 − ---------------- */
    {
      id: 'q09',
      dim: 'order',
      text: '你写提示词时，通常是哪种画风？',
      options: [
        { text: '先发一句再说，聊歪了就现场拽回来。', scores: { order: -1 } },
        { text: '老任务用老模板，新任务现想现写。', scores: { order: 0 } },
        { text: '常用模板一打开，改几处要求就能开工。', scores: { order: 1, drive: -1 } }
      ]
    },
    {
      id: 'q10',
      dim: 'order',
      text: '一项复杂任务摆在面前，你通常先做什么？',
      options: [
        { text: '拆步骤、排顺序。清单列好了，我才踏实。', scores: { order: 1, role: 1 } },
        { text: '先挑一块做起来，说不定做着做着就顺了。', scores: { order: -1 } },
        { text: '先试试最没把握的部分，再决定后面怎么安排。', scores: { order: 0 } }
      ]
    },
    {
      id: 'q11',
      dim: 'order',
      text: '朋友借你电脑，点开了你的文件夹。你最可能说？',
      options: [
        { text: '“这阵子有点乱，忙完我就收拾。”', scores: { order: 0 } },
        { text: '“都分好类了，你要找哪个？”', scores: { order: 1, heart: -1 } },
        { text: '“先别动，我知道它大概在哪儿。”', scores: { order: -2 } }
      ]
    },
    {
      id: 'q12',
      dim: 'order',
      text: 'AI 给你一份内容，你最在意什么？',
      options: [
        { text: '看拿来干什么，正式要用的规整点，找灵感时可以放飞点。', scores: { order: 0 } },
        { text: '有我没想到的点子，看完还想接着试。', scores: { order: -2 } },
        { text: '条理清楚，最好能存成下次直接用的模板。', scores: { order: 1, drive: -1 } }
      ]
    },

    /* ---------------- 协作姿态：主导派 + ←→ 副驾派 − ---------------- */
    {
      id: 'q13',
      dim: 'role',
      text: '你和 AI 组队干活，开局通常是谁带路？',
      options: [
        { text: '看情况，谁更熟这一块，谁先来。', scores: { role: 0 } },
        { text: '它先给几个方案，我来挑、来改。', scores: { role: -2 } },
        { text: '我先定好目标和步骤，它帮我往下做。', scores: { role: 1, order: 1 } }
      ]
    },
    {
      id: 'q14',
      dim: 'role',
      text: 'AI 和你各持己见，谁也没说服谁。下一步你会？',
      options: [
        { text: '先按我的想法改一版，我想看看能做成什么样。', scores: { role: 2, heart: -1 } },
        { text: '行，你先把理由和方案讲完整，我再决定。', scores: { role: -2 } },
        { text: '别争了，两种都试试，结果出来再说。', scores: { role: 0 } }
      ]
    },
    {
      id: 'q15',
      dim: 'role',
      text: '任务做到一半，你和 AI 的日常更像？',
      options: [
        { text: '它交草稿，我圈圈改改，让它再来一版。', scores: { role: -2 } },
        { text: '谁更熟悉当前这一步谁先来，做着做着就换手了。', scores: { role: 0 } },
        { text: '我安排下一步，它按我的要求接着做。', scores: { role: 1, order: 1 } }
      ]
    },
    {
      id: 'q16',
      dim: 'role',
      text: '一觉醒来，AI 强了十倍。你准备怎么给它安排工作？',
      options: [
        { text: '先试用一下新本事，摸清以后再分工。', scores: { role: 0 } },
        { text: '太好了，我定方向，它把执行部分多扛一点。', scores: { role: 1, drive: -1 } },
        { text: '先让它拿个方案，我负责挑、改和最后把关。', scores: { role: -2 } }
      ]
    }
  ]
};
