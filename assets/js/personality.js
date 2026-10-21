/* =============================================================================
 *  AI 协作机体测试 · 计分与匹配引擎
 * =============================================================================
 *  规则与 resources/新题目与计分说明.md 一致：
 *
 *  1. 四维原始分 s 的范围均为 -8 ~ +8，归一化坐标 x = s / 8。
 *  2. 左侧展示 = round(50 + 50x)，右侧 = 100 - 左侧；0 分固定显示 50:50，
 *     不把中性悄悄归到某一端。
 *  3. 八种机体是四维空间里的八个原型，用同样的距离权重找最近的：
 *        D = ((x1-p1)^2 + (x2-p2)^2 + (x3-p3)^2 + (x4-p4)^2) / 4
 *     距离相同 → 全部保留为并列候选；最佳与次佳差 ≤ 1/16 → 提示“同时接近”。
 *  4. profileCode 只是给数据留存用的四维方向（E/D、W/L、S/I、P/C，中性为 X），
 *     不参与机体编号，也不在前端展示。
 *  5. 机体编号 M01-M08 只是类别标识，前端只显示机体名。
 *
 *  纯函数实现，浏览器与 Node 测试可共用。
 * ========================================================================== */

(function (root) {
  'use strict';

  var DIM_ORDER = ['drive', 'heart', 'order', 'role'];
  var NEAR_THRESHOLD = 1 / 16;
  var TYPE_COUNT = 8;

  /* ------------------------------ 八个原型坐标 ------------------------------ */
  /* 顺序固定：drive / heart / order / role；八个原型等范数，并组成四对相反画像。 */
  var PROTOTYPES = [
    { id: 'M01', slug: 'machine-soul',    coord: { drive: 1,     heart: 0.75,  order: 0.5,    role: 0.25  } },
    { id: 'M02', slug: 'neon-hollow',     coord: { drive: 0.5,   heart: 0.25,  order: -1,     role: -0.75 } },
    { id: 'M03', slug: 'data-diver',      coord: { drive: 0.25,  heart: -0.5,  order: 0.75,   role: -1    } },
    { id: 'M04', slug: 'module-breaker',  coord: { drive: 0.75,  heart: -1,    order: -0.25,  role: 0.5   } },
    { id: 'M05', slug: 'channel-tuner',   coord: { drive: -0.75, heart: 1,     order: 0.25,   role: -0.5  } },
    { id: 'M06', slug: 'ddl-navigator',   coord: { drive: -0.25, heart: 0.5,   order: -0.75,  role: 1     } },
    { id: 'M07', slug: 'protocol-forger', coord: { drive: -0.5,  heart: -0.25, order: 1,      role: 0.75  } },
    { id: 'M08', slug: 'field-fixer',     coord: { drive: -1,    heart: -0.75, order: -0.5,   role: -0.25 } }
  ];

  var OPPOSITE = {
    M01: 'M08', M08: 'M01',
    M02: 'M07', M07: 'M02',
    M03: 'M06', M06: 'M03',
    M04: 'M05', M05: 'M04'
  };

  /* ------------------------------ 八种机体的文案 ------------------------------ */
  var CONTENT = {
    M01: {
      name: '机魂总调度',
      tagline: '脑洞已经接入，先把大家的频道对齐。',
      desc: '你的脑洞不满足于独自闪烁，更想把人和 AI 接成一张任务网。你习惯先问清大家要什么，再把新想法拆成能推进的线路；如果讨论开始四处冒火花，你会想给它们找个总开关。',
      strengths: [
        '愿意为新点子留出试运行的入口',
        '在分派任务前关注沟通是否对齐',
        '倾向把讨论逐步接到可推进的步骤上'
      ],
      watch: [
        '线路接得太多时，可能迟迟没有关闭多余任务',
        '为了让各方都跟上，可能反复调整已经够用的安排'
      ],
      tips: [
        '每轮只保留一个正在验证的新方向',
        '把交给 AI 的任务写成一句明确要求',
        '收尾时说明哪些结果需要自己再核对'
      ],
      oppositeNote: '一个把全局接成任务网，一个先把眼前修好；凑在一起，刚好一个铺线、一个落地。'
    },
    M02: {
      name: '霓虹树洞',
      tagline: '先接住这句话，下一步边聊边长出来。',
      desc: '一句没说清的想法，也能成为你和 AI 聊下去的入口。你愿意顺着有感觉的线索走，边接话边发现方向；比起立刻套进固定步骤，你更喜欢给对话留一点自由生长的空间。',
      strengths: [
        '愿意让尚未成形的想法先进入对话',
        '接受 AI 提案后再一起修改的协作方式',
        '不急着让每次交流都套进同一份模板'
      ],
      watch: [
        '来回接话可能延长讨论，下一步却仍未落定',
        '对话顺畅时，可能晚一点才检查信息是否可靠'
      ],
      tips: [
        '聊完补一句现在准备做什么',
        '把情绪支持与事实查证分成两个问题',
        '为开放讨论留一个可以停下来的时间点'
      ],
      oppositeNote: '一个让对话自由生长，一个把经验铸成流程；你们合在一起，灵感和章法都不会缺席。'
    },
    M03: {
      name: '数据潜航员',
      tagline: '让 AI 先下潜，沿着证据链慢慢打捞。',
      desc: '你愿意让 AI 先带出一条线索，再沿着依据、步骤和记录继续下潜。新发现可以很诱人，但你总想知道它从哪里来、哪些部分值得相信。上浮时，最好能带回一盒整理好的证据。',
      strengths: [
        '倾向在接纳建议时继续追问依据',
        '愿意借助步骤和记录整理复杂信息',
        '接受从 AI 的初稿或提案开始协作'
      ],
      watch: [
        '核对路线不断加深时，可能忘记原本只想回答的小问题',
        'AI 给出的结构很完整时，可能较晚才重新审视前提'
      ],
      tips: [
        '下潜前写清这次只需要确认的问题',
        '让 AI 区分已知事实与推测',
        '找一条独立来源核对最关键的结论'
      ],
      oppositeNote: '一个沿着证据慢慢下潜，一个盯着终点随时改线；一个求稳，一个求进，刚好互相校准。'
    },
    M04: {
      name: '义体拆解客',
      tagline: '先拆开看看，再决定这块模块怎么接。',
      desc: '新工具到手，你的好奇心已经开始找螺丝刀。你喜欢自己设一个小问题，换几种接法，看反馈到底怎么变；说明书可以参考，下一步实验通常由你来定。',
      strengths: [
        '愿意通过小尝试了解工具的边界',
        '倾向要求能够解释或核对的反馈',
        '在探索中保留自己安排下一步的空间'
      ],
      watch: [
        '新接口很有意思时，可能把原任务暂时拆散',
        '只顾眼前实验，可能没有留下足够的复用说明'
      ],
      tips: [
        '动手前只选一个想验证的假设',
        '记录一次成功输入和一次失败输入',
        '试完用三句话说明发现与适用范围'
      ],
      oppositeNote: '一个先拆开、亲手验证，一个先听清、把声道调顺；一个开路，一个收束，配合起来更完整。'
    },
    M05: {
      name: '人机调音师',
      tagline: '先听清这次要什么，再把人机声道调顺。',
      desc: '你希望事情有个着落，也希望沟通能落在合适的频道上。AI 可以先交一版，你会按人的感受和实际要求慢慢调；内容、语气与需求终于对上时，整条声道才算顺了。',
      strengths: [
        '愿意把当前需要和交流感受一起说出来',
        '接受先有草稿再逐步调节的过程',
        '倾向把讨论收向这次真正需要的结果'
      ],
      watch: [
        '反复调整语气时，可能压缩了事实核对的时间',
        '为了让互动顺滑，可能较晚才提出自己不同意的部分'
      ],
      tips: [
        '先列出结果必须满足的两项要求',
        '分别检查内容是否准确与表达是否合适',
        '不同意时直接指出需要修改的位置'
      ],
      oppositeNote: '一个先听清、慢慢调，一个先拆开、马上试；一个负责顺，一个负责快，互补得正好。'
    },
    M06: {
      name: 'DDL领航员',
      tagline: '终点先标出来，航线允许途中改。',
      desc: '你喜欢先把终点标出来，再握着方向盘灵活改线。AI 的建议、现场的反馈、人的需要都可以成为新路标；你在意的是这一轮怎样继续推进，而不是每一步都必须照原路线走。',
      strengths: [
        '倾向先说明这轮协作准备往哪里走',
        '愿意在反馈出现后调整具体路径',
        '在推动任务时给沟通和换挡留出空间'
      ],
      watch: [
        '临时改线较多时，可能需要额外解释当前版本',
        '想继续推进时，可能没有单独留出最后复核的时间'
      ],
      tips: [
        '先约定一个最小可交付的结果',
        '每次改方向都补一句现在以什么为准',
        '结束前留一个固定的人工检查节点'
      ],
      oppositeNote: '一个盯终点、随时改线，一个沿证据、慢慢打捞；一个敢冲，一个敢查，能互相兜底。'
    },
    M07: {
      name: '协议铸造师',
      tagline: '接口先约好，再让任务一段段接起来。',
      desc: '你喜欢先约好输入、步骤和验收方式，再让任务一段段接起来。遇到反复出现的工作，你会想把经验铸成模板或流程，让下一轮协作有章可循；必要时，也会为例外留一个手动接口。',
      strengths: [
        '愿意明确任务的输入与输出要求',
        '倾向为常见协作保留可复用的步骤',
        '在使用 AI 时保留安排顺序与检查节点的空间'
      ],
      watch: [
        '模板越来越完整时，可能不太愿意临时换一种做法',
        '小任务也采用完整流程时，可能增加不必要的步骤'
      ],
      tips: [
        '按任务大小决定需要几步流程',
        '给模板留一处可以偏离常规的出口',
        '定期删去没有实际作用的检查项'
      ],
      oppositeNote: '一个把经验铸成流程，一个让对话自由生长；一个给骨架，一个给血肉，凑在一起刚刚好。'
    },
    M08: {
      name: '外脑快修侠',
      tagline: '先处理眼前这件事，方法够用就上手。',
      desc: '眼前有件事卡住了，你会先让 AI 拿出几种可用方案，挑一版试起来，再按现场情况补一块、换一块。工具合用就上手，方法不必拘泥；收工前，把真正需要自己接管的部分留在视线里。',
      strengths: [
        '倾向围绕当前需要提出具体问题',
        '愿意先拿一版方案进行实际修改',
        '接受按任务变化调整做法而非固定走同一路线'
      ],
      watch: [
        '眼前方案已经可用时，可能没有记录它依赖的条件',
        '连续解决小问题时，可能较晚才回看整体是否一致'
      ],
      tips: [
        '使用建议前确认最重要的一个前提',
        '把需要反复操作的部分记成简短清单',
        '任务结束后检查哪些地方仍要自己接手'
      ],
      oppositeNote: '一个先解决眼前，一个先接住全局；一个现场动手，一个统筹线路，搭在一起很顺。'
    }
  };

  /* ------------------------------ 组装类型表 ------------------------------ */

  var TYPES = PROTOTYPES.map(function (p) {
    var c = CONTENT[p.id];
    return {
      id: p.id,
      slug: p.slug,
      name: c.name,
      tagline: c.tagline,
      desc: c.desc,
      strengths: c.strengths.slice(),
      watch: c.watch.slice(),
      tips: c.tips.slice(),
      image: 'assets/img/' + p.id.toLowerCase() + '.webp',
      thumb: 'assets/img/thumbs/' + p.id.toLowerCase() + '.webp',
      oppositeId: OPPOSITE[p.id],
      oppositeNote: c.oppositeNote,
      coord: {
        drive: p.coord.drive,
        heart: p.coord.heart,
        order: p.coord.order,
        role: p.coord.role
      }
    };
  });

  var TYPE_BY_ID = {};
  var TYPE_BY_SLUG = {};
  TYPES.forEach(function (t, i) {
    t.index = i;
    TYPE_BY_ID[t.id] = t;
    TYPE_BY_SLUG[t.slug] = t;
  });

  /* ------------------------------ 工具函数 ------------------------------ */

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function dimKeys(survey) {
    var keys = Object.keys((survey && survey.dimensions) || {});
    var ordered = DIM_ORDER.filter(function (k) { return keys.indexOf(k) >= 0; });
    keys.forEach(function (k) { if (ordered.indexOf(k) < 0) ordered.push(k); });
    return ordered;
  }

  /** 每个维度的理论最低/最高分（题目改动后自动适配） */
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

  /** 原始分 → 归一化坐标（每一维除以该维理论极值的绝对值；对称时即 s/8） */
  function normalize(raw, survey) {
    var keys = dimKeys(survey);
    var range = theoreticalRange(survey);
    var out = {};
    keys.forEach(function (k) {
      var maxAbs = Math.max(range[k].max, -range[k].min);
      out[k] = maxAbs > 0 ? clamp(Number(raw[k] || 0) / maxAbs, -1, 1) : 0;
    });
    return out;
  }

  function distanceTo(type, x) {
    var sum = 0;
    for (var i = 0; i < DIM_ORDER.length; i++) {
      var k = DIM_ORDER[i];
      var d = Number(x[k] || 0) - type.coord[k];
      sum += d * d;
    }
    return sum / DIM_ORDER.length;
  }

  /** 归一化坐标 → 最近机体、并列候选、次佳差距 */
  function matchNormalized(x) {
    var distances = {};
    var best = Infinity;
    TYPES.forEach(function (t) {
      var d = distanceTo(t, x);
      distances[t.id] = d;
      if (d < best) best = d;
    });

    var candidates = TYPES.filter(function (t) {
      return Math.abs(distances[t.id] - best) < 1e-9;
    });
    var rest = TYPES.filter(function (t) { return candidates.indexOf(t) < 0; })
      .sort(function (a, b) { return distances[a.id] - distances[b.id]; });
    var second = rest.length ? distances[rest[0].id] : null;

    var near = [];
    if (candidates.length === 1 && second !== null && (second - best) <= NEAR_THRESHOLD + 1e-12) {
      near = rest.filter(function (t) {
        return (distances[t.id] - best) <= NEAR_THRESHOLD + 1e-12;
      });
    }

    var allNeutral = DIM_ORDER.every(function (k) { return Math.abs(Number(x[k] || 0)) < 1e-12; });

    return {
      candidates: candidates,
      display: candidates[0],
      distances: distances,
      bestDistance: best,
      secondDistance: second,
      tie: candidates.length > 1,
      allNeutral: allNeutral && candidates.length === TYPE_COUNT,
      near: near
    };
  }

  /** 原始分直接匹配（测试/后台排查用，正式流程请用 score） */
  function matchRaw(raw, survey) {
    return matchNormalized(normalize(raw || {}, survey));
  }

  /**
   * 计分主函数
   * @param {Object} survey  window.SURVEY
   * @param {Object} answers { q01: 0, q02: 2, ... }（选项下标）
   */
  function score(survey, answers) {
    var keys = dimKeys(survey);
    var questions = (survey && survey.questions) || [];
    var range = theoreticalRange(survey);
    var raw = {};
    keys.forEach(function (k) { raw[k] = 0; });

    var answered = 0;
    var detail = [];

    questions.forEach(function (q) {
      var idx = answers ? answers[q.id] : undefined;
      if (idx === undefined || idx === null || idx === '') return;
      idx = Number(idx);
      if (!isFinite(idx) || Math.floor(idx) !== idx || idx < 0 || idx >= (q.options || []).length) return;
      var opt = q.options[idx];
      if (!opt) return;
      answered++;
      var picked = {};
      keys.forEach(function (k) {
        var v = Number((opt.scores && opt.scores[k]) || 0);
        if (v) { raw[k] += v; picked[k] = v; }
      });
      detail.push({ id: q.id, index: idx, text: opt.text, score: picked });
    });

    var total = questions.length;
    var complete = total > 0 && answered === total;

    var x = {};
    keys.forEach(function (k) {
      var maxAbs = Math.max(range[k].max, -range[k].min);
      x[k] = maxAbs > 0 ? raw[k] / maxAbs : 0;
    });

    var match = matchNormalized(x);

    var percents = {};
    keys.forEach(function (k) {
      var dim = (survey.dimensions && survey.dimensions[k]) || {};
      var left = dim.left || {};
      var right = dim.right || {};
      var leftPct = clamp(Math.round(50 + 50 * x[k]), 0, 100);
      percents[k] = {
        left: leftPct,
        right: 100 - leftPct,
        leftName: left.name || '',
        rightName: right.name || '',
        leftCode: left.code || '',
        rightCode: right.code || '',
        pole: raw[k] > 0 ? 'left' : (raw[k] < 0 ? 'right' : 'neutral'),
        raw: raw[k],
        normalized: x[k]
      };
    });

    var profileCode = keys.map(function (k) {
      var dim = (survey.dimensions && survey.dimensions[k]) || {};
      if (raw[k] > 0) return (dim.left && dim.left.code) || 'X';
      if (raw[k] < 0) return (dim.right && dim.right.code) || 'X';
      return 'X';
    }).join('');

    return {
      complete: complete,
      answered: answered,
      total: total,
      raw: raw,
      normalized: x,
      percents: percents,
      profileCode: profileCode,
      candidates: match.candidates,
      display: match.display,
      distances: match.distances,
      bestDistance: match.bestDistance,
      secondDistance: match.secondDistance,
      tie: match.tie,
      allNeutral: match.allNeutral,
      near: match.near,
      detail: detail
    };
  }

  function typeById(id) { return TYPE_BY_ID[id] || null; }
  function typeBySlug(slug) { return TYPE_BY_SLUG[String(slug || '')] || null; }

  /** 分享文案：只有机体名，不带任何字母代号 */
  function shareText(result, survey) {
    if (!result || !result.display) return '';
    var lines = [];
    lines.push('我的 AI 协作机体是「' + result.display.name + '」');
    lines.push(result.display.tagline);
    var keys = Object.keys((survey && survey.dimensions) || {});
    keys.forEach(function (k) {
      var dim = survey.dimensions[k];
      var p = result.percents && result.percents[k];
      if (!p) return;
      if (p.pole === 'neutral') {
        lines.push('· ' + dim.label + '：均衡 50:50');
      } else {
        lines.push('· ' + dim.label + '：' + p.leftName + ' ' + p.left + '% / ' + p.rightName + ' ' + p.right + '%');
      }
    });
    if (result.tie && result.candidates.length > 1) {
      lines.push('（同时贴近：' + result.candidates.map(function (t) { return t.name; }).join('、') + '；并列，展示顺序不代表更准确）');
    } else if (result.near && result.near.length) {
      lines.push('（同时接近「' + result.near[0].name + '」，这只是展示提示）');
    }
    lines.push('你也来测测自己的协作机体 →');
    return lines.join('\n');
  }

  var Engine = {
    DIM_ORDER: DIM_ORDER,
    NEAR_THRESHOLD: NEAR_THRESHOLD,
    types: TYPES,
    prototypes: PROTOTYPES,
    dimKeys: dimKeys,
    theoreticalRange: theoreticalRange,
    normalize: normalize,
    matchRaw: matchRaw,
    score: score,
    typeById: typeById,
    typeBySlug: typeBySlug,
    shareText: shareText
  };

  root.Engine = Engine;
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
