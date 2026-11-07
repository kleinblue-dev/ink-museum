// content/content.js —— 墨馆唯一内容源（Lead 维护）
// 改文案 / 换场景 / 调墨色，只改这一个文件；前台与后端都从这里读。
// 字段契约见 docs/SPEC.md 第 3 节。所有页面可见文字都从这里取，禁止散落硬编码。

export const CONTENT = {
  version: '1.0.0',

  museum: {
    title: '墨馆',
    subtitle: '一馆山水，一卷自己。',
    kicker: '宋元水墨 · 数字小馆',
    enter: '入馆',
    museumLabel: '馆藏',
    aboutLabel: '关于',
    soundOn: '声 · 开',
    soundOff: '声 · 关'
  },

  ethics: {
    short: '一段与自己的相处 · 不是医疗建议',
    long: '这是一段自我陪伴的练习，不是医疗建议，也不替代专业支持。引导语是提前写好的，不评价你、不诊断你。你随时可以离开，关掉页面就好。',
    privacy: '作答与墨迹默认只留在这台设备。只有你点「存进馆藏」时，才会把画卷和匿名编号传上去；不含姓名、手机号等身份信息。',
    credits: '背景取自宋元名作，均属公有领域；墨块取自《芥子园画传》（清代刻本，公有领域）。出处与授权见关于页。'
  },

  entry: {
    bg: { wide: 'assets/bg/entry-wide.webp', tall: 'assets/bg/entry-tall.webp', position: '50% 46%' },
    credit: '富春山居图 · 黄公望',
    hint: '点一下，就进去'
  },

  pre: {
    sign: '来时',
    title: '先看一眼此刻',
    hint: '三点都碰一下',
    items: [
      { key: 'tight', label: '紧' },
      { key: 'tired', label: '累' },
      { key: 'scattered', label: '乱' }
    ],
    ends: ['不', '很'],
    next: '往里走'
  },

  scene: {
    sign: '择境',
    title: '想去哪里待一会儿',
    back: '返回'
  },

  line: {
    sign: '一句',
    next: '落墨',
    replies: [
      { key: 'look', label: '看一看' },
      { key: 'stay', label: '待一会儿' },
      { key: 'silent', label: '不语' }
    ]
  },

  ink: {
    sign: '落墨',
    title: '让手先安静下来',
    hint: '不必画得像什么',
    finish: '收笔',
    noInk: '也可以不落墨'
  },

  post: {
    sign: '此刻',
    title: '再看一眼',
    hint: '凭第一感觉',
    moodLabel: '此刻，像什么？',
    moods: [
      { key: 'quiet', label: '静' },
      { key: 'loose', label: '松' },
      { key: 'far', label: '远' },
      { key: 'empty', label: '空' }
    ],
    next: '收卷'
  },

  scenes: [
    {
      id: 'spring',
      name: '早春',
      work: { title: '早春图', artist: '郭熙', dynasty: '北宋' },
      bg: {
        wide: 'assets/bg/spring-wide.webp',
        tall: 'assets/bg/spring-tall.webp',
        thumb: 'assets/bg/spring-thumb.webp',
        position: '50% 42%'
      },
      opening: ['山还在长，不必现在就好。'],
      closing: ['看着它长，也算陪着。'],
      ink: { palette: ['#24201a', '#6d5638', '#96402f'], defaultColor: 0 }
    },
    {
      id: 'water',
      name: '静水',
      work: { title: '水图', artist: '马远', dynasty: '南宋' },
      bg: {
        wide: 'assets/bg/water-wide.webp',
        tall: 'assets/bg/water-tall.webp',
        thumb: 'assets/bg/water-thumb.webp',
        position: '50% 50%'
      },
      opening: ['水没有要赶去的地方。'],
      closing: ['你也一样。'],
      ink: { palette: ['#1e2426', '#485a5e', '#8f4a36'], defaultColor: 0 }
    },
    {
      id: 'bamboo',
      name: '疏竹',
      work: { title: '墨竹图', artist: '文同', dynasty: '北宋' },
      bg: {
        wide: 'assets/bg/bamboo-wide.webp',
        tall: 'assets/bg/bamboo-tall.webp',
        thumb: 'assets/bg/bamboo-thumb.webp',
        position: '50% 40%'
      },
      opening: ['竹叶之间，都是空。'],
      closing: ['空着，也很好。'],
      ink: { palette: ['#20241f', '#4a5b45', '#9a3d2c'], defaultColor: 0 }
    },
    {
      id: 'pavilion',
      name: '空亭',
      work: { title: '容膝斋图', artist: '倪瓒', dynasty: '元' },
      bg: {
        wide: 'assets/bg/pavilion-wide.webp',
        tall: 'assets/bg/pavilion-tall.webp',
        thumb: 'assets/bg/pavilion-thumb.webp',
        position: '50% 48%'
      },
      opening: ['亭子空着，风可以进来。'],
      closing: ['坐一会儿，不必做什么。'],
      ink: { palette: ['#23201b', '#5c5346', '#a03f2f'], defaultColor: 0 }
    }
  ],

  scroll: {
    sign: '收卷',
    title: '这一卷',
    seal: '墨馆',
    footer: '二〇二六 · kleinblue-dev',
    save: '存进馆藏',
    saved: '已存进馆藏',
    saveLocal: '已存本机馆藏',
    saveFail: '暂存本机',
    download: '带走画卷',
    again: '再走一厅',
    hint: '长按或右键可保存',
    restored: '墨已干，重走一厅吧',
    changeLabel: '来时 → 此刻',
    noChange: '没有变化，也是一种答案'
  },

  gallery: {
    title: '馆藏',
    subtitle: '众手所留',
    empty: '还没有人留下画卷。',
    localTag: '本机',
    remoteTag: '馆藏',
    close: '合上',
    loadError: '馆藏暂不可见',
    cardHint: '点开看看'
  },

  about: {
    title: '关于',
    close: '合上',
    what: '「墨馆」把墨间的八步相处与墨心的落墨合成一条动线：看一眼此刻，选一幅画待一会儿，落一笔墨，收成一卷。它不是测验，不打分、不评级、不诊断，也没有心理学量表。',
    how: '建议戴耳机，慢慢来。约五到八分钟。',
    privacy: '作答与墨迹默认只留在这台设备。点「存进馆藏」时只上传画卷与匿名编号，不含姓名、手机号等身份信息。',
    credits: '背景取自宋元名作（公有领域）：富春山居图·黄公望、早春图·郭熙、水图·马远、墨竹图·文同、容膝斋图·倪瓒。墨块取自《芥子园画传》白描页（清代刻本，公有领域）。整理、程序与整体设计：kleinblue-dev。',
    prevTitle: '前身',
    prev: [
      { name: '墨间', url: 'https://kleinblue-dev.github.io/mojian/' },
      { name: '墨心', url: 'https://kleinblue-dev.github.io/ink-mind/' }
    ],
    sourceTitle: '源码',
    repo: 'https://github.com/kleinblue-dev/ink-museum',
    clearLabel: '清空本机记录',
    cleared: '已清空',
    version: 'v1.0.0'
  },

  feedback: {
    better: ['松了一点。', '轻了一点。', '松了一寸。'],
    same: ['还是那样，也没关系。'],
    worse: ['今天不松，也可以。']
  },

  ui: {
    back: '返回',
    undo: '撤销',
    clear: '重来',
    brush: '笔',
    stamp: '墨块',
    tone: ['淡', '中', '浓'],
    size: '大小',
    rotate: '转',
    more: '更多',
    done: '好了',
    close: '合上',
    retry: '再试一次',
    off: '关',
    on: '开'
  },

  // 芥子园墨块（与 data/masks.json 的 11 个 id 一一对应；前台墨块托盘用）
  stamps: [
    { id: 'w-wave', label: '水纹', group: '远景' },
    { id: 'g-tupo', label: '土坡', group: '中景' },
    { id: 't-liu', label: '柳', group: '中景' },
    { id: 'h-maowu', label: '茅屋', group: '点缀' },
    { id: 'h-trellis', label: '花架', group: '点缀' },
    { id: 'f-zaocha', label: '煎茶', group: '点缀' },
    { id: 'f-xizhan', label: '洗盏', group: '点缀' },
    { id: 'f-baoxi', label: '抱膝', group: '点缀' },
    { id: 'f-xiyao', label: '洗药', group: '点缀' },
    { id: 'f-yuweng', label: '垂钓', group: '点缀' },
    { id: 'f-banzeng', label: '扳罾', group: '点缀' }
  ],

  // 墨色调色板（INDEX 与 scenes[].ink.palette 对齐，前台/引擎共用）
  paletteNames: ['墨', '赭', '青', '朱']
};

export default CONTENT;
