import { QUEST_MENU } from './prizeTableData.js';

const L = (zh, en) => ({ zh, en });

// ============================================================
// 分幕数据（剧情设计-拾荒娃娃机.md 的代码化；文案/时长都在这改，不动引擎）
//
// 每幕字段：
//   label   幕标题卡          layout  画幅位 right/center/wide
//   viewportShape  可选 circle（圆形 clip，一二幕试镜）
//   control 输入权限           tuning  幕间爪力曲线（难度旋钮）
//   quest   任务格 id          questCount 每格需要几个（缺省 1）
//   appearance 该幕奖池显示的态：'manifest'（显形/他以为的）| 'rot'（败露/真实）
//   appearanceAfter 换货推迟到上一幕的 #glitch 全黑里执行（终幕用；见 director.js）
//   restockPool 进幕把已入洞物品放回池里（第三幕补第二幕抓走的那件）
//   hint    底部操作提示（null=隐藏）
//   script  步骤序列：
//     { sub, dur }            底部字幕（半透明底，逐字），dur 秒
//     { panel, side, text, dur? }  左右字；text:'' 收起；无 dur 常驻
//       continue + continueAfter：先只显示本侧，点击该框或到时再往下走（也可派发 window 事件 narrative:continue）
//       hideAfter：本步结束后收起，避免左右同时占屏
//     { hint }                改底部提示
//     { pause, dur }          留白，dur 秒
//     { wait: 事件名 }         等待事件：firstView / allViews / firstCollect / questComplete / cinemaWidened
//     { synthesis }           四幕合成演出
//     { poolScan, dur, restore?, preset? } 俯拍扫过奖池（备用机位，终幕已经不用了）
//     { fadeGhost, dur, hold? } 把世界淡成一层淡影（不是消失）
//     { fadeMachine, dur, stage } stage: 'all'（默认，整机三段交叠溶解：壳→东西→台子）
//                                        | 'shell'（只走壳）| 'core'（爪子+装饰+池里的东西）
//                                直到全透明为止，**不隐藏**：画面随后被 reveal 的过渡接走
//     { restore }             把镜头交还给三观察位（扫视角收尾）
//     { glitch, image? }      终幕故障转场；省略 image 则仅音画故障/黑场，不叠概念图
//     { interstitial, image, dur?, fadeIn?, fadeOut?, dipBefore?, dipAfter? }
//       实现 narrativeBg.showInterstitial；导演 #run 顺序执行 script
//       闪回后旁白卡顿：多为淡出后再 _runDip（见 present.transition.interstitialDipAfter）
//     { revealBeat, line, image?, dur? }
//     { reveal }              尘屑过渡 + Marble（main onRevealTransition）
//     { stinger }             终幕手写体收尾 + 八音盒彩蛋钩子
//   backdrop  幕背景（narrativeAssets 键名）
//   hudDecor  第三幕配额 HUD 装饰（如 rationWall）
//
// 文体纪律（全片）：旁白永远第三人称"他"，不出现"我"。
// 第三幕起不出现"移动""落爪"字样。黑场四句台词语气与第三幕完全一致，不许变调。
// ============================================================

export const DEFAULT_HINT = L(
  '←→↑↓ / WASD 移动 · 空格 落爪 · 1/2/3 视角 · Q/E 循环',
  '←→↑↓ / WASD move · Space drop · 1/2/3 view · Q/E cycle',
);

/** 每格配额需要抓几件（缺省 1）。改这个要同步 index.html 的 #q-* 文案与 "N/3" 计数。 */
export const QUEST_COUNT = 1;

// 试玩：http://127.0.0.1:8000/?act=5（devServer 根即 prototype，无需 /prototype）；终幕 Y 再玩一次

export const ACTS = [
  // ---------------------------------------------------------------
  // 第一幕 · 引子：干净柜，全是他记得的样子。只能看，不能抓。
  // ---------------------------------------------------------------
  {
    id: 1, label: L('第一幕 · 引子', 'Act I · Prologue'), layout: 'right', backdrop: 'act1', viewportShape: 'circle',
    control: { move: false, drop: false, view: false },
    appearance: 'manifest',
    zoom: 0.95,   // 幕级变焦；near 模式再 ×0.7 → 有效 0.67，贴近玻璃柜的近景
    framing: 'near',   // 右布局必须 near（投影绑定画幅中心；far 不绑定会只露个边）
    hint: null,
    script: [
      // 黑屏先念两句。圆视窗和背景随后才开，娃娃机先藏着预加载
      { type: 'sub', text: L('资源枯竭纪元 21 年。', 'Year 21 of the scarcity era.'), dur: 5.6 },
      { type: 'sub', text: L('配给制度崩坏，人们靠"采集"活下去。', 'The ration system has collapsed. People live by “foraging.”'), dur: 6.4 },
      { type: 'openViewport' },
      { type: 'pause', dur: 2.5 },
      { type: 'panel', side: 'left', text: L('他还记得那台机器。\n那时候，食物是装在玻璃柜里的。', 'He still remembers that machine.\nBack then, food sat inside a glass case.') },
      { type: 'pause', dur: 5 },
      { type: 'panel', side: 'left', text: L('他还记得那台机器。\n那时候，食物是装在玻璃柜里的。', 'He still remembers that machine.\nBack then, food sat inside a glass case.'), op: L('点击照片收起', 'Tap the photo to put it away') },
      { type: 'interstitial', image: 'act1Open', caption: L('干净得不像话。', 'Too clean to be true.'), dismiss: 'click', dismissAfter: 0, revealOnShow: true, revealAfter: 5 },
      { type: 'panel', side: 'left', text: L('那时候经常趴在两边往里看。', 'He used to lean in from both sides and look.') },
      { type: 'pause', dur: 1.6 },
      { type: 'panel', side: 'left', text: L('那时候经常趴在两边往里看。', 'He used to lean in from both sides and look.'), op: L('Q / E　或　1 / 2 / 3 转动视线。', 'Q / E or 1 / 2 / 3 to look around.') },
      { type: 'allow', view: true },
      { type: 'wait', event: 'firstView' },
      { type: 'sub', text: L('左边……右边……都一样。都是吃的。', 'Left… right… the same. All of it food.'), dur: 4.8 },
      { type: 'wait', event: 'allViews' },
      // 落灰：左字跟着第二张相框换，点一下或停够再收
      { type: 'panel', side: 'left', text: L('不知道什么时候变旧了。', 'He doesn’t know when it got old.'), op: L('点击照片收起', 'Tap the photo to put it away') },
      { type: 'interstitial', image: 'act1Close', dur: 4, caption: L('后来就旧了。', 'Then it got old.'), dismiss: 'click', dismissAfter: 8 },
    ],
  },

  // ---------------------------------------------------------------
  // 第二幕 · 学会抓：教学。首次必成。手与妹妹这两件事在这一幕埋下。
  // ---------------------------------------------------------------
  {
    id: 2, label: L('第二幕 · 学会抓', 'Act II · Learning to Grab'), layout: 'center', backdrop: 'act2', viewportShape: 'circle',
    control: { move: true, drop: true, view: true },
    appearance: 'manifest',
    framing: 'far',   // 中远景站远抓（首版构图）；V 键可切 near 凑近看
    tuning: { gripStrength: 1.0, baseSlipProb: 0 },   // 教学：首抓必成
    hint: DEFAULT_HINT,
    script: [
      { type: 'panel', side: 'left', text: L('移动爪子。\n对准。', 'Move the claw.\nLine it up.'), continue: true, continueAfter: 3.4, hideAfter: true },
      { type: 'panel', side: 'right', text: L('按下空格。\n落爪。', 'Press space.\nDrop.') },
      { type: 'wait', event: 'firstCollect' },
      { type: 'panel', side: 'right', text: '' },
      // 闪回：记忆里那只按按钮的手（终幕现实里的手是同一只）
      { type: 'interstitial', image: 'flashbackSister', dur: 3.2, caption: L('那天的照片。', 'The photo from that day.') },
      { type: 'panel', side: 'left', text: L('成功了。\n他和妹妹分着吃。', 'It worked.\nHe and his sister split it.'), dur: 4 },
      // 说明图：第一次让玩家看见"手心里是什么"，也是终幕反转的伏笔种子
      { type: 'interstitial', image: 'act2Close', dur: 3.0, caption: L('他手里是干净的。', 'What he held was clean.') },
    ],
  },

  // ---------------------------------------------------------------
  // 第三幕 · 配额：同样的三件，光不够了。抓够 3 格 ×1 件即过。
  // 配额按"形状"记账不看外观：显形态面包与败露态发霉块都算面包。
  // ---------------------------------------------------------------
  {
    id: 3, label: L('第三幕 · 采集配额', 'Act III · The Quota'), layout: 'center', backdrop: 'act3', hudDecor: 'rationWall',
    control: { move: true, drop: true, view: true },
    appearance: 'manifest',
    tuning: { gripStrength: 0.78, baseSlipProb: 0.45, decayPerGrab: 0.06 },  // 爪力开始不稳
    // 兜底：连续失败 streak 次后每次回升抓力；进幕 forceAfterSeconds 秒后抓到即成、不滑
    pity: { streak: 2, gripStep: 0.08, slipStep: 0.06, forceAfterSeconds: 90 },
    quest: QUEST_MENU.ids,
    questCount: QUEST_COUNT,
    // 配额按形状记账：一件东西只有一条表项，败露态是它的另一副面孔（同一个 id），
    // 所以不需要别名表 —— 抓到就是那一格。
    restockPool: true,   // 第二幕抓走的那件补回池里
    questCopy: {
      right: {
        bread: L('面包，入账。', 'Bread, logged.'),
        can: L('罐头。', 'A can.'),
        veg: L('青菜。', 'Greens.'),
      },
      dup: L('……这一样够了。', '…That’s enough of this one.'),
      wrong: L('……这不是今天的配额。', '…This isn’t today’s quota.'),
      wrongJunk: L('垃圾也进洞了。不算数。', 'Junk went down the hole too. It doesn’t count.'),
    },
    hint: L(
      '←→↑↓ / WASD 移动 · 空格 落爪 · 1/2/3 视角 · Q/E 循环 · V 凑近/退远 · 滚轮缩放',
      '←→↑↓ / WASD move · Space drop · 1/2/3 view · Q/E cycle · V closer/farther · wheel zoom',
    ),
    script: [
      { type: 'interstitial', image: 'rationNotice', dur: 3.0, caption: L('今天的配额。', 'Today’s quota.') },
      { type: 'panel', side: 'left', text: L('配额写在墙上了。\n今天也是三样。', 'The quota is on the wall.\nThree things again today.'), continue: true, continueAfter: 3.6, hideAfter: true },
      { type: 'panel', side: 'right', text: L('抓够之前，\n别去想机器外面是什么。', 'Until you’ve got enough,\ndon’t wonder what’s outside the machine.') },
      // 题眼：与第一幕同机位的一闪，柜里其实是腐败的。玩家会以为自己看错了。
      // 这一张故意切得快、淡得浅 —— 它要像"看错了"，不像"给你看张图"。
      { type: 'interstitial', image: 'act3Dark', dur: 2.0, fadeIn: 0.3, fadeOut: 0.4, caption: '' },
      { type: 'wait', event: 'questComplete' },
      // 集齐瞬间：过曝 + 耳鸣 + 灯泡骤亮，整池东西"看起来"又是新鲜的了
      { type: 'interstitial', image: 'act3LightLie', dur: 1.4, fadeIn: 0.1, fadeOut: 0.4, caption: '' },
      { type: 'sub', text: L('……齐了。今天能吃了。', '…That’s all of them. He can eat today.'), dur: 2.5 },
    ],
  },

  // ---------------------------------------------------------------
  // 第四幕 · 他记得的那顿饭：配给单翻面成菜单，机柜淡回干净柜。全片最暖处。
  // ---------------------------------------------------------------
  {
    id: 4, label: L('第四幕 · 他记得的那顿饭', 'Act IV · The Meal He Remembers'), layout: 'center', backdrop: 'synthesis',
    control: { move: false, drop: false, view: false },
    appearance: 'manifest',
    hint: null,
    menu: {
      cards: [
        L('面包汤', 'Bread soup'),
        L('罐头', 'A can'),
        L('烫青菜', 'Blanched greens'),
      ],
      line: L('今日菜单\n面包汤 · 罐头 · 烫青菜', 'Today’s menu\nBread soup · A can · Blanched greens'),
    },
    script: [
      { type: 'panel', side: 'left', text: '' },
      { type: 'panel', side: 'right', text: '' },
      { type: 'interstitial', image: 'menuCard', dur: 2.6, caption: L('翻过来，就是今天吃什么。', 'Turn it over. That’s dinner.') },
      { type: 'synthesis' },
      { type: 'interstitial', image: 'act4Meal', dur: 3.4, caption: '' },
      { type: 'pause', dur: 0.8 },
      { type: 'sub', text: L('那天他们吃得很好。', 'They ate well that day.'), dur: 3.4 },
      { type: 'pause', dur: 1.2 },
      { type: 'sub', text: L('他一直是这么记的。', 'That’s how he has always remembered it.'), dur: 3.6 },
      { type: 'pause', dur: 2.0 },   // 这 2 秒留给玩家反应"他是不是在骗自己"
    ],
  },

  // ---------------------------------------------------------------
  // 终幕 · 醒：故障 → 黑场换货 → 他还在给自己圆 → 俯拍扫过 → 16:9 真相。
  //
  // 换货发生在 #glitch 的全黑 1.4s 里（main.js 的 onPoolAppearance），
  // 玩家看不到换的过程；黑场结束后池里全是败露态（发霉面包/锈罐/烂菜）。
  // ---------------------------------------------------------------
  {
    id: 5, label: '', layout: 'center', backdrop: 'ambient', backdropAfter: 'glitch',
    control: { move: false, drop: false, view: false },
    // 注意这里是 appearanceAfter 不是 appearance：
    // 这一幕是"醒来"，换货不能等到进幕（那时画面已经不黑了），
    // 得让上一幕的 #glitch 抢在全黑 1.4s 里换完（见 director.js #glitch 的换货段）。
    appearanceAfter: 'rot',
    framing: 'far',
    hint: null,
    script: [
      { type: 'glitch' },
      // 换货 + 消失全都发生在原地：**镜头一次都不动**。
      // 他还在用刚才那副视角看着同一个柜子，只是柜子在化、东西在变。
      { type: 'sub', text: L('……灯怎么灭了。', '…Why did the light go out.'), dur: 3.0 },
      { type: 'pause', dur: 0.6 },
      { type: 'sub', text: L('面包。罐头。青菜。', 'Bread. A can. Greens.'), dur: 3.4 },
      { type: 'pause', dur: 0.8 },
      { type: 'sub', text: L('都是好的。', 'All of it good.'), dur: 2.8 },
      { type: 'pause', dur: 1.0 },
      // 把"谎言"直接说成"条件"——他不是不知道
      { type: 'sub', text: L('只要灯亮着就行。', 'As long as the light stays on.'), dur: 3.2 },
      { type: 'pause', dur: 1.4 },
      // 整机溶解：壳先淡 → 爪子/装饰跟上 → 台子收尾，池里那几件东西**最后才走**。
      // 一路淡到全透明，画面自然溶解进后面的实景 —— 不是淡完就隐藏，也没有切视角。
      { type: 'fadeMachine', dur: 9.5, stage: 'all' },
      { type: 'pause', dur: 0.4 },
      { type: 'revealBeat', dur: 3.4, line: L('手心里只有一罐。', 'Only a can in his palm.') },
      { type: 'reveal' },
      { type: 'wait', event: 'cinemaWidened' },
      { type: 'pause', dur: 1.5 },
      { type: 'revealBeat', dur: 3.0, line: L('远处那台，还亮着。', 'Far off, that machine is still lit.') },
      { type: 'stinger', text: L('Demo 结束。他今天吃了什么？', 'Demo over. What did he eat today?') },
    ],
  },
];
