/** api.minimax.cn t2a_v2 官方模型枚举（speech-2.8 最新，turbo 为低延迟档） */
export const TTS_MODELS = [
  'speech-2.8-turbo', 'speech-2.8-hd',
  'speech-2.6-turbo', 'speech-2.6-hd',
  'speech-02-turbo', 'speech-02-hd',
  'speech-01-turbo', 'speech-01-hd',
]

/** minimax 系统音色（官方音色表中文部分；其他语种/复刻音色仍可通过设置 REST 写入） */
export const VOICE_GROUPS: Array<{ label: string; voices: Array<[string, string]> }> = [
  {
    label: '中文（普通话）',
    voices: [
      ['female-shaonv', '少女音色'], ['female-yujie', '御姐音色'], ['female-chengshu', '成熟女性音色'],
      ['female-tianmei', '甜美女性音色'], ['female-shaonv-jingpin', '少女音色·beta'], ['female-yujie-jingpin', '御姐音色·beta'],
      ['female-chengshu-jingpin', '成熟女性音色·beta'], ['female-tianmei-jingpin', '甜美女性音色·beta'],
      ['male-qn-qingse', '青涩青年音色'], ['male-qn-jingying', '精英青年音色'], ['male-qn-badao', '霸道青年音色'],
      ['male-qn-daxuesheng', '青年大学生音色'], ['male-qn-qingse-jingpin', '青涩青年音色·beta'], ['male-qn-jingying-jingpin', '精英青年音色·beta'],
      ['male-qn-badao-jingpin', '霸道青年音色·beta'], ['male-qn-daxuesheng-jingpin', '青年大学生音色·beta'],
      ['clever_boy', '聪明男童'], ['cute_boy', '可爱男童'], ['lovely_girl', '萌萌女童'], ['cartoon_pig', '卡通猪小琪'],
      ['bingjiao_didi', '病娇弟弟'], ['junlang_nanyou', '俊朗男友'], ['chunzhen_xuedi', '纯真学弟'],
      ['lengdan_xiongzhang', '冷淡学长'], ['badao_shaoye', '霸道少爷'], ['tianxin_xiaoling', '甜心小玲'],
      ['qiaopi_mengmei', '俏皮萌妹'], ['wumei_yujie', '妩媚御姐'], ['diadia_xuemei', '嗲嗲学妹'], ['danya_xuejie', '淡雅学姐'],
      ['Chinese (Mandarin)_Reliable_Executive', '沉稳高管'], ['Chinese (Mandarin)_News_Anchor', '新闻女声'],
      ['Chinese (Mandarin)_Mature_Woman', '傲娇御姐'], ['Chinese (Mandarin)_Unrestrained_Young_Man', '不羁青年'],
      ['Arrogant_Miss', '嚣张小姐'], ['Robot_Armor', '机械战甲'], ['Chinese (Mandarin)_Kind-hearted_Antie', '热心大婶'],
      ['Chinese (Mandarin)_HK_Flight_Attendant', '港普空姐'], ['Chinese (Mandarin)_Humorous_Elder', '搞笑大爷'],
      ['Chinese (Mandarin)_Gentleman', '温润男声'], ['Chinese (Mandarin)_Warm_Bestie', '温暖闺蜜'],
      ['Chinese (Mandarin)_Male_Announcer', '播报男声'], ['Chinese (Mandarin)_Sweet_Lady', '甜美女声'],
      ['Chinese (Mandarin)_Southern_Young_Man', '南方小哥'], ['Chinese (Mandarin)_Wise_Women', '阅历姐姐'],
      ['Chinese (Mandarin)_Gentle_Youth', '温润青年'], ['Chinese (Mandarin)_Warm_Girl', '温暖少女'],
      ['Chinese (Mandarin)_Kind-hearted_Elder', '花甲奶奶'], ['Chinese (Mandarin)_Cute_Spirit', '憨憨萌兽'],
      ['Chinese (Mandarin)_Radio_Host', '电台男主播'], ['Chinese (Mandarin)_Lyrical_Voice', '抒情男声'],
      ['Chinese (Mandarin)_Straightforward_Boy', '率真弟弟'], ['Chinese (Mandarin)_Sincere_Adult', '真诚青年'],
      ['Chinese (Mandarin)_Gentle_Senior', '温柔学姐'], ['Chinese (Mandarin)_Stubborn_Friend', '嘴硬竹马'],
      ['Chinese (Mandarin)_Crisp_Girl', '清脆少女'], ['Chinese (Mandarin)_Pure-hearted_Boy', '清澈邻家弟弟'],
      ['Chinese (Mandarin)_Soft_Girl', '柔和少女'],
    ],
  },
  {
    label: '中文（粤语）',
    voices: [
      ['Cantonese_ProfessionalHost（F)', '专业女主持'], ['Cantonese_GentleLady', '温柔女声'],
      ['Cantonese_ProfessionalHost（M)', '专业男主持'], ['Cantonese_PlayfulMan', '活泼男声'],
      ['Cantonese_CuteGirl', '可爱女孩'], ['Cantonese_KindWoman', '善良女声'],
    ],
  },
]
