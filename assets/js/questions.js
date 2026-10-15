/* =============================================================================
 *  问卷数据文件 —— 想改题目，只改这个文件就够了
 * =============================================================================
 *  规则说明（照着改不会出错）：
 *  1. questions 数组里每一题都可以自由增加/删除/改文字，顺序就是出题顺序。
 *  2. 每题的 options 至少 2 个（建议 3 个），每个 option 的 text 是按钮上的文字。
 *  3. option.scores 表示这个选项给各个维度加多少分，可以写正数也可以写负数，
 *     不写等于 0。可用的维度 key 只有 4 个：
 *        drive  → 正分偏「探索派 E」  负分偏「交付派 D」
 *        heart  → 正分偏「共情派 W」  负分偏「逻辑派 L」
 *        order  → 正分偏「结构派 S」  负分偏「灵感派 I」
 *        role   → 正分偏「主导派 P」  负分偏「副驾派 C」
 *  4. 分数绝对值大小只表示「倾向强度」，程序会自动按每题的理论最高/最低分做归一化，
 *     所以你改写分数（比如把 2 改成 3）不会破坏百分比显示。
 *  5. 改完题目后，把 meta.version 改一下（例如 v1.1），后台就能看出数据是哪一版问卷。
 * ========================================================================== */

window.SURVEY = {
  meta: {
    id: 'ai-personality',
    version: 'v1.0',
    title: 'AI 人格测试',
    subtitle: '16 道题，测出你在人机协作里的真实人格',
    estimated: '约 3 分钟',
    intro:
      '你有没有想过，你使用 AI 的方式，其实暴露了你的性格？\n' +
      '这 16 道题没有对错，请凭第一反应选择最像你的那一项。',
    // 结果页底部显示的话
    footerNote: '本测试结果仅供自我探索参考，不是心理诊断，也不代表能力高低。',
    // 提交前的告知文案（合规用，可自行修改）
    privacyNote:
      '为改进测试，我们会匿名记录你的选项、结果类型和作答耗时（不收集姓名、手机号等个人信息）。',
    // 需要用户勾选同意才继续；不需要就设为 false
    requireConsent: true,
    // 是否让用户填昵称（可留空）
    askNickname: true,
    nicknamePlaceholder: '昵称（可留空）'
  },

  /* 4 个维度：left = 正分那一侧，right = 负分那一侧 */
  dimensions: {
    drive: {
      label: '驱动方式',
      left: { code: 'E', name: '探索派', motto: '先跳进去，边试边找路' },
      right: { code: 'D', name: '交付派', motto: '先定目标，把结果拿出来' }
    },
    heart: {
      label: '交互偏好',
      left: { code: 'W', name: '共情派', motto: '先对齐感受，再谈事情' },
      right: { code: 'L', name: '逻辑派', motto: '信息准确比好听重要' }
    },
    order: {
      label: '做事方式',
      left: { code: 'S', name: '结构派', motto: '有流程，才有复利' },
      right: { code: 'I', name: '灵感派', motto: '先动起来，灵感在路上' }
    },
    role: {
      label: '协作姿态',
      left: { code: 'P', name: '主导派', motto: '我定方向，AI 出力' },
      right: { code: 'C', name: '副驾派', motto: '它给方案，我来掌舵' }
    }
  },

  questions: [
    /* ---------------- 驱动方式：探索 E ←→ 交付 D ---------------- */
    {
      id: 'q01',
      text: '拿到一个全新的 AI 工具，你的第一反应是？',
      options: [
        { text: '先随手点一圈，看它到底能玩出什么花样', scores: { drive: 2, order: -1 } },
        { text: '找一份文档或教程，按流程完整跑通一遍', scores: { drive: -2, order: 1 } },
        { text: '直接把它扔进手头正在做的任务里试水', scores: { role: 1 } }
      ]
    },
    {
      id: 'q02',
      text: 'AI 的答案里冒出一个你从没想过的方向，你会：',
      options: [
        { text: '兴奋，顺着追问下去，说不定能长成新项目', scores: { drive: 2, order: -1 } },
        { text: '先判断能不能落地，不能就先存档', scores: { drive: -2, order: 1 } },
        { text: '让它同时给我一个脑洞版和一个落地版', scores: { drive: 1, role: 1 } }
      ]
    },
    {
      id: 'q03',
      text: '你更享受 AI 带来的哪种瞬间？',
      options: [
        { text: '突然被打开一个新世界的顿悟感', scores: { drive: 2, heart: 1 } },
        { text: '一堆杂事被干净利落解决的爽感', scores: { drive: -2, order: 1 } },
        { text: '来回打磨几轮，最后结果比我想的还好', scores: { drive: 1, heart: 1 } }
      ]
    },
    {
      id: 'q04',
      text: '一个做了两周的 AI 项目，中途发现原目标价值不大了：',
      options: [
        { text: '那就转向，看看能挖出什么新东西', scores: { drive: 2, order: -1 } },
        { text: '先把原目标收尾交付，再开新的', scores: { drive: -2, order: 1 } },
        { text: '重新定一个更小的目标，快速验证', scores: { drive: 1 } }
      ]
    },

    /* ---------------- 交互偏好：共情 W ←→ 逻辑 L ---------------- */
    {
      id: 'q05',
      text: '向 AI 描述问题时，你更常这样开口：',
      options: [
        { text: '“我现在有点乱，你先帮我理一理”', scores: { heart: 2, order: -1 } },
        { text: '“这是数据、约束和目标，请给我最优解”', scores: { heart: -2, order: 1 } },
        { text: '“我先讲下背景，你帮我判断我卡在哪”', scores: { heart: 1, role: 1 } }
      ]
    },
    {
      id: 'q06',
      text: 'AI 的回答完全正确，但语气冷冰冰：',
      options: [
        { text: '有点别扭，我会让它换个说法', scores: { heart: 2, role: 1 } },
        { text: '无所谓，信息准确就行', scores: { heart: -2, order: 1 } },
        { text: '先谢它一句，再提我的要求', scores: { heart: 1, role: 1 } }
      ]
    },
    {
      id: 'q07',
      text: '同事使用 AI 的方式和你完全不同：',
      options: [
        { text: '先理解他为什么这么做，再想怎么配合', scores: { heart: 2, role: -1 } },
        { text: '比较两套做法的效率，用数据说话', scores: { heart: -2, order: 1 } },
        { text: '各做各的，最后产出能对上就行', scores: { heart: -1, role: -1 } }
      ]
    },
    {
      id: 'q08',
      text: '你更希望 AI 出现在什么时候？',
      options: [
        { text: '情绪卡住、思路打结的时候', scores: { heart: 2, order: -1 } },
        { text: '我很清楚要什么、只需要它执行的时候', scores: { heart: -2, role: 1 } },
        { text: '任何时候，只要我需要有人接话', scores: { heart: 1, role: -1 } }
      ]
    },

    /* ---------------- 做事方式：结构 S ←→ 灵感 I ---------------- */
    {
      id: 'q09',
      text: '你写提示词的习惯更像：',
      options: [
        { text: '有一套自己的模板，变量填进去就行', scores: { order: 2, drive: -1 } },
        { text: '每次现写，边写边看它怎么反应', scores: { order: -2, drive: 1 } },
        { text: '先随手写一版，再迭代个三五轮', scores: { order: -1, drive: 1 } }
      ]
    },
    {
      id: 'q10',
      text: '面对一个复杂任务，你的第一个动作是：',
      options: [
        { text: '拆成清单，排出优先级', scores: { order: 2, heart: -1 } },
        { text: '凭直觉先开个头，走一步看一步', scores: { order: -2, drive: 1 } },
        { text: '先跟 AI 聊十分钟，把问题聊清楚', scores: { order: -1, heart: 1 } }
      ]
    },
    {
      id: 'q11',
      text: '你的文件、收藏夹、笔记区状态是：',
      options: [
        { text: '分类清楚、命名规范，随时都能找到', scores: { order: 2, drive: -1 } },
        { text: '很乱，但我知道东西大概在哪', scores: { order: -2, drive: 1 } },
        { text: '定期大扫除，平时随意', scores: { order: -1 } }
      ]
    },
    {
      id: 'q12',
      text: 'AI 给出的内容，你最在意的是：',
      options: [
        { text: '结构清晰、可复用、能直接交出去', scores: { order: 2, heart: -1 } },
        { text: '有惊喜，有我自己想不到的连接', scores: { order: -2, drive: 1 } },
        { text: '读起来舒服，像人写的', scores: { order: -1, heart: 1 } }
      ]
    },

    /* ---------------- 协作姿态：主导 P ←→ 副驾 C ---------------- */
    {
      id: 'q13',
      text: '在人机协作里，你更常扮演：',
      options: [
        { text: '我定方向，它负责干活', scores: { role: 2, drive: -1 } },
        { text: '它给方案，我挑一个改改', scores: { role: -1, heart: 1 } },
        { text: '我们一起推进，随时换手', scores: { heart: 1 } }
      ]
    },
    {
      id: 'q14',
      text: 'AI 的建议和你的判断冲突时：',
      options: [
        { text: '相信自己的判断，让它按我说的改', scores: { role: 2, order: 1 } },
        { text: '让它把理由讲清楚，谁有道理听谁的', scores: { role: -1, heart: -1 } },
        { text: '两个都试一下，用结果说话', scores: { role: -1, drive: 1 } }
      ]
    },
    {
      id: 'q15',
      text: '你更希望别人这样形容你：',
      options: [
        { text: '“带着 AI 往前冲的那个人”', scores: { role: 2, drive: -1 } },
        { text: '“把 AI 用到极致的那个人”', scores: { role: 1, order: 1 } },
        { text: '“能和 AI 聊到一块儿的那个人”', scores: { role: -1, heart: 2 } }
      ]
    },
    {
      id: 'q16',
      text: '如果 AI 忽然比现在强 10 倍：',
      options: [
        { text: '太好了，我要去做一直想做但做不成的事', scores: { role: 1, drive: 2 } },
        { text: '先想想我现在做的事会不会被取代', scores: { role: -2, heart: -1 } },
        { text: '更好奇它到底是怎么变强的', scores: { role: -1, drive: 1 } }
      ]
    }
  ]
};
