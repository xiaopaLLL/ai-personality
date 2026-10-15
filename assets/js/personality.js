/* =============================================================================
 *  计分引擎 + 16 型人格库
 * =============================================================================
 *  这个文件一般不需要改。改题型请改 questions.js。
 *  Engine 是纯函数集合，可以在浏览器和 Node 里直接用（方便跑测试）。
 * ========================================================================== */

(function (root) {
  'use strict';

  var DIM_ORDER = ['drive', 'heart', 'order', 'role'];

  /* ------------------------- 16 型人格内容库 ------------------------- */
  var TYPES = {
    EWSP: {
      name: '提示词总导演', emoji: '🎬',
      tagline: '用自己的一套方法，把 AI 带去没人去过的地方',
      desc: '你既想要新可能，也相信方法。你会先跟 AI 把话说清、把感觉对齐，再用自己那套流程把它推向一个新方向。团队里「试得最早、讲得最明白」的那个人，通常是你。',
      strengths: ['能把模糊灵感变成可复用的提示词流程', '对 AI 的语气和情绪敏感，产出有「人味」', '敢第一个跳进去试，也愿意回头总结方法'],
      watch: ['同时开太多新方向，收尾常得靠别人', '对流程的讲究有时拖慢了野蛮生长的速度'],
      tips: ['给每个新想法设一个「48 小时内判断去留」的关卡', '把你的提示词模板沉淀成团队共享资产', '每周留一次不带目的的乱试时间']
    },
    EWSC: {
      name: '灵感整理师', emoji: '📮',
      tagline: '温柔地和 AI 一起乱想，再把想法整理成册',
      desc: '你喜欢和 AI 来回聊，从对话里挖出好东西，然后一点点把它整理清楚。你不急着当主角，更享受「我们一起想出来了」的那种默契。',
      strengths: ['善于用追问把 AI 的潜力逼出来', '能把散乱的对话变成结构清晰的笔记', '是团队里的润滑剂，让人愿意开口'],
      watch: ['容易聊得很嗨，但迟迟不落地', '不太抢方向盘，好想法可能被别人拿走'],
      tips: ['每次聊完固定写三行「下一步做什么」', '主动把整理结果发出去，让贡献被看见', '把「最后帮我收口」这类任务交给 AI']
    },
    EWIP: {
      name: '脑洞共创官', emoji: '🎠',
      tagline: '脑洞开到最大，快乐地和 AI 一起造东西',
      desc: '你的关键词是「好玩」。你不太在意规矩，想到就拉着 AI 一起试，经常在玩的过程里撞出别人想不到的创意。',
      strengths: ['创意密度高，能把不相干的东西连起来', '对 AI 的反馈天然敏感，配合默契', '启动速度快，从想法到原型只要半天'],
      watch: ['热情来得快去得也快，容易半途换方向', '流程和文档对你来说太枯燥，交付质量不稳定'],
      tips: ['找一个「收尾搭子」帮你把成品打磨完', '把大创意切成三个小实验，逐个验证', '给每次发散设一个明确的停手信号']
    },
    EWIC: {
      name: '灵感缪斯', emoji: '🌙',
      tagline: '把 AI 当成树洞和镜子，在对话里认识自己',
      desc: '你和 AI 的关系更像朋友。你用它梳理情绪、整理思绪，很少把它当工具使唤。你的深度对话能力，常常能挖出别人挖不到的东西。',
      strengths: ['能问出别人问不出的好问题', '对语言和情绪的分寸感很强', '持续记录与反思，积累深厚'],
      watch: ['容易陷在「聊得很爽」里，实际产出偏少', '较少把 AI 用在高强度交付场景'],
      tips: ['给每次深度对话留一个产出物（一段文字或一个决定）', '试试用 AI 直接推进一件卡了很久的实事', '把对话笔记定期整理成可分享的内容']
    },
    ELSP: {
      name: '探索型架构师', emoji: '🏗️',
      tagline: '先摸清 AI 的边界，再给它设计一套跑得通的系统',
      desc: '你好奇，但更讲逻辑。你喜欢把新工具的边界摸透，然后设计出一套别人也能照着跑的方法。你是那种「先把地图画出来」的探索者。',
      strengths: ['系统化能力强，能把探索成果变成方法', '对模型能力边界判断准确', '抽象与结构化表达出色'],
      watch: ['容易在「设计完美流程」上花太久', '对人的情绪信号不够敏感'],
      tips: ['先跑通最小闭环，再谈架构', '文档里多写「为什么这样做」，帮别人少踩坑', '把方法讲给非技术同事听，检验可用性']
    },
    ELSC: {
      name: '前沿研究员', emoji: '🔬',
      tagline: '安静地把每个新模型都试一遍，然后告诉你结论',
      desc: '你更像研究者：不追热闹，但每次评测都有自己的判断。你习惯把问题拆开、验证、记录，再给出严谨的结论。',
      strengths: ['实验设计严谨，结论可信', '善于对比评测，能给出选型建议', '独立工作能力强，不需要被推动'],
      watch: ['喜欢研究，但推广和表达偏少', '追求完备，容易错过窗口期'],
      tips: ['给研究设一个「够用了就发出去」的标准', '用一页纸把结论推给需要的人', '把重复的评测流程自动化']
    },
    ELIP: {
      name: '极客拆解者', emoji: '🔧',
      tagline: '不信宣传，亲手把模型拆开看看它到底行不行',
      desc: '你对 AI 的态度是「先试试再说」。你爱走非主流路径，用奇怪的方式试出边界，对原理的兴趣远大于官方说明。',
      strengths: ['动手能力强，能快速验证真伪', '善于发现工具的非典型用法', '不怕失败，试错成本控制得好'],
      watch: ['容易一头钻进技术细节，忽略真实需求', '对规范和协作流程耐心不足'],
      tips: ['每次拆解前先写下「要回答什么问题」', '把发现整理成团队能用的技巧清单', '提醒自己：能用就行，不必知晓一切']
    },
    ELIC: {
      name: '实验室游侠', emoji: '🧪',
      tagline: '一个人、一台电脑，把 AI 的每个角落都试过一遍',
      desc: '你独立、理性、爱较真。你不太需要别人配合，自己就能搭起一套实验，慢慢把问题搞清楚。你是那种「数据不撒谎」的人。',
      strengths: ['独立探索的续航力强', '对细节和异常敏感', '结论经得起复现'],
      watch: ['容易低估沟通成本，成果传播有限', '较少主动争取资源和关注'],
      tips: ['把过程记录成可复现的清单，方便交接', '主动找一个人对齐方向，避免白做', '定期把成果换成看得见的产出']
    },
    DWSP: {
      name: 'AI 工作流总监', emoji: '📊',
      tagline: '目标清晰、共情到位，把 AI 编进团队的生产线',
      desc: '你知道要什么，也懂人。你会先跟人对齐，再设计一套人机配合的流程，让整件事又快又稳地交付出来。',
      strengths: ['能把 AI 落地成可复制的团队流程', '沟通与推进力强，跨部门也推得动', '对交付质量和节奏敏感'],
      watch: ['流程依赖度高，遇到例外情况会不顺', '容易把自己变成瓶颈'],
      tips: ['给流程留一个「手动兜底」的出口', '培养第二个人接手你的流程', '定期砍掉不再增值的环节']
    },
    DWSC: {
      name: '团队 AI 赋能师', emoji: '🤝',
      tagline: '把好用的 AI 方法，手把手教给身边每个人',
      desc: '你的成就感来自「大家一起变强」。你会主动整理、分享、答疑，把 AI 从一个工具变成一个团队习惯。',
      strengths: ['同理心强，能照顾不同水平的同事', '擅长把复杂方法讲简单', '自发建设团队氛围'],
      watch: ['揽下太多答疑，自己的深度工作被切碎', '不好意思拒绝别人的求助'],
      tips: ['把常见问题做成可自助查阅的文档', '设定固定答疑时间，其他时间保持专注', '给自己留一个「只属于我」的进阶项目']
    },
    DWIP: {
      name: '增长操盘手', emoji: '🚀',
      tagline: '要结果、要速度，也要人愿意跟着你跑',
      desc: '你擅长在不确定里快速出手：先用 AI 做出粗胚，再用直觉判断往哪推，边跑边调。你最怕的不是犯错，而是慢。',
      strengths: ['决策快，能在模糊中推进', '对结果负责，交付意识强', '善于带动氛围，让人愿意跟上'],
      watch: ['追求速度时容易忽略细节和风险', '对慢节奏的同事缺少耐心'],
      tips: ['关键决策前强制做一次「最坏情况」检查', '给细节型同事留出校验时间', '把「试过但废掉」的方案也记录下来']
    },
    DWIC: {
      name: '敏捷交付者', emoji: '🎯',
      tagline: '靠 AI 一个人干完一支队伍的活，稳稳交付',
      desc: '你务实、灵活、配合度高。给你一个目标，你能自己拆、自己试、自己交付，中间不太需要人盯着。',
      strengths: ['独立交付能力强，靠谱', '学习和调整速度快', '对人和流程都不挑，适应性强'],
      watch: ['默默扛下太多，容易被当成理所当然', '较少主动提出更大的目标'],
      tips: ['定期主动同步进度，让价值被看见', '接活前先确认优先级，而不是全接', '给自己的工作设一个升级方向']
    },
    DLSP: {
      name: 'AI 系统工程师', emoji: '⚙️',
      tagline: '把 AI 变成一条稳定、可复用、能追溯的流水线',
      desc: '你要结果，也要秩序。你会把 AI 严格约束在流程里：输入规范、输出可控、失败可回溯。你是团队里「这事交给他就放心」的角色。',
      strengths: ['工程化能力强，方案稳定可维护', '质量控制严格，交付可信', '擅长把一次性成果变成资产'],
      watch: ['对探索性、没有标准答案的任务不够耐心', '流程偏重，小任务上显得过度设计'],
      tips: ['按任务规模选择「重流程」还是「轻流程」', '定期花时间试新工具，防止方案老化', '把规范写成模板，减少沟通成本']
    },
    DLSC: {
      name: '质量守门人', emoji: '🛡️',
      tagline: '每一个 AI 输出，都要先过你这道审校关',
      desc: '你谨慎、严谨、责任感强。你会核对事实、检查逻辑、补齐边界条件，别人敢直接使用你过手的稿子。',
      strengths: ['查错能力强，能发现别人忽略的问题', '标准清晰，判断一致', '责任感强，交付质量有保证'],
      watch: ['审校耗时长，容易成为流程瓶颈', '对「差不多就行」的场景过于较真'],
      tips: ['按重要度分档，不同档位用不同审校强度', '把常犯错误做成清单，加速核对', '提醒自己：及时交付也是一种质量']
    },
    DLIP: {
      name: '自动化猎人', emoji: '🕹️',
      tagline: '找到重复劳动，用 AI 一枪打掉它',
      desc: '你对「浪费时间的重复」极其敏感，总在琢磨怎么让 AI 少让人动手。你喜欢动手做小工具，做完立刻见效。',
      strengths: ['自动化嗅觉敏锐，投入产出意识强', '动手快，能立刻做出可用的小工具', '善于把逻辑判断变成规则'],
      watch: ['过度自动化，维护成本反而变高', '没耐心做文档和交接'],
      tips: ['先算「维护成本 vs 节省时间」再动手', '给脚本写三行使用说明', '把自动化成果登记成清单，别重复造轮子']
    },
    DLIC: {
      name: '精准执行者', emoji: '🎖️',
      tagline: '指令清楚、结果干净，你是 AI 最喜欢的那种人',
      desc: '你务实、直接、配合度高。你清楚要什么，表达简洁，AI 给你的结果往往直接能用。你不追求花哨，只追求这件事被干净完成。',
      strengths: ['需求表达准确，返工率低', '执行稳定，质量一致', '不计较形式，聚焦结果'],
      watch: ['较少主动探索新玩法，容易停在熟练区', '不太主动表达自己的贡献'],
      tips: ['每月留一点时间试一个新工具', '把你的提问方式记成模板分享出去', '主动争取更有挑战性的任务']
    }
  };

  /* ------------------------------ 工具函数 ------------------------------ */

  function dimKeys(survey) {
    var keys = Object.keys((survey && survey.dimensions) || {});
    // 保持固定顺序，保证四字代码稳定
    var ordered = DIM_ORDER.filter(function (k) { return keys.indexOf(k) >= 0; });
    keys.forEach(function (k) { if (ordered.indexOf(k) < 0) ordered.push(k); });
    return ordered;
  }

  /** 计算每个维度的理论最低分/最高分（问卷改动后自动适配） */
  function theoreticalRange(survey) {
    var keys = dimKeys(survey);
    var range = {};
    keys.forEach(function (k) { range[k] = { min: 0, max: 0 }; });
    ((survey && survey.questions) || []).forEach(function (q) {
      keys.forEach(function (k) {
        var vals = (q.options || []).map(function (o) {
          return Number((o.scores && o.scores[k]) || 0);
        });
        if (!vals.length) return;
        range[k].min += Math.min.apply(null, vals);
        range[k].max += Math.max.apply(null, vals);
      });
    });
    return range;
  }

  /**
   * 计分
   * @param {Object} survey  window.SURVEY
   * @param {Object} answers { q01: 0, q02: 2, ... } 选项下标
   * @returns {Object} 结果对象（可直接存库）
   */
  function score(survey, answers) {
    var keys = dimKeys(survey);
    var range = theoreticalRange(survey);
    var raw = {};
    keys.forEach(function (k) { raw[k] = 0; });

    var answered = 0;
    var detail = [];

    (survey.questions || []).forEach(function (q) {
      var idx = answers ? answers[q.id] : undefined;
      if (idx === undefined || idx === null || idx === '') return;
      var opt = (q.options || [])[idx];
      if (!opt) return;
      answered++;
      var picked = {};
      keys.forEach(function (k) {
        var v = Number((opt.scores && opt.scores[k]) || 0);
        raw[k] += v;
        if (v) picked[k] = v;
      });
      detail.push({ id: q.id, index: Number(idx), text: opt.text, scores: picked });
    });

    var codes = [];
    var percents = {};
    var poles = {};
    keys.forEach(function (k) {
      var r = range[k];
      var span = r.max - r.min;
      var pct = span > 0 ? ((raw[k] - r.min) / span) * 100 : 50;
      pct = Math.max(0, Math.min(100, pct));
      var left = survey.dimensions[k].left;
      var right = survey.dimensions[k].right;
      var isLeft = raw[k] > 0 || (raw[k] === 0 && pct >= 50);
      poles[k] = isLeft ? left.code : right.code;
      codes.push(poles[k]);
      percents[k] = {
        left: Math.round(pct),
        right: 100 - Math.round(pct),
        leftCode: left.code, rightCode: right.code,
        leftName: left.name, rightName: right.name,
        pole: isLeft ? 'left' : 'right'
      };
    });

    var code = codes.join('');
    var type = TYPES[code] || null;

    return {
      code: code,
      name: type ? type.name : '未知类型',
      emoji: type ? type.emoji : '❓',
      tagline: type ? type.tagline : '',
      answered: answered,
      total: (survey.questions || []).length,
      scores: raw,
      percents: percents,
      poles: poles,
      detail: detail
    };
  }

  /** 取互补类型代码（每个维度取反） */
  function flipCode(code) {
    var map = { E: 'D', D: 'E', W: 'L', L: 'W', S: 'I', I: 'S', P: 'C', C: 'P' };
    return String(code || '').split('').map(function (c) { return map[c] || c; }).join('');
  }

  function typeOf(code) { return TYPES[code] || null; }

  /** 生成分享用的纯文本结果 */
  function shareText(result, survey) {
    var lines = [];
    lines.push('我的 AI 人格是「' + result.name + '」' + result.emoji + '（' + result.code + '）');
    lines.push(result.tagline || '');
    if (survey && survey.dimensions) {
      Object.keys(survey.dimensions).forEach(function (k) {
        var p = result.percents[k];
        if (!p) return;
        lines.push('· ' + survey.dimensions[k].label + '：' + p.leftName + ' ' + p.left + '% / ' + p.rightName + ' ' + p.right + '%');
      });
    }
    lines.push('你也来测测自己的 AI 人格 →');
    return lines.join('\n');
  }

  var Engine = {
    DIM_ORDER: DIM_ORDER,
    TYPES: TYPES,
    dimKeys: dimKeys,
    theoreticalRange: theoreticalRange,
    score: score,
    flipCode: flipCode,
    typeOf: typeOf,
    shareText: shareText
  };

  root.Engine = Engine;
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
