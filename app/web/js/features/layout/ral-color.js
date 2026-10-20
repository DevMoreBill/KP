/** Цвета RAL Classic (открытый список ral-colors, MIT) и простые действия над цветом. */
export class RalColor {
  static TABLE = `
1000 CDBA88  1001 D0B084  1002 D2AA6D  1003 F9A800  1004 E49E00  1005 CB8E00  1006 E29000  1007 E88C00  1011 AF804F  1012 DDAF27
1013 E3D9C6  1014 DDC49A  1015 E6D2B5  1016 F1DD38  1017 F6A950  1018 FACA30  1019 A48F7A  1020 A08F65  1021 F6B600  1023 F7B500
1024 BA8F4C  1026 FFFF00  1027 A77F0E  1028 FF9B00  1032 E2A300  1033 F99A1C  1034 EB9C52  1035 908370  1036 80643F  1037 F09200
2000 DD7907  2001 BE4E20  2002 C63927  2003 FA842B  2004 E75B12  2005 FF2300  2007 FFA421  2008 F3752C  2009 E15501  2010 D4652F
2011 EC7C25  2012 DB6A50  2013 954527  2017 FA4402  3000 AB2524  3001 A02128  3002 A1232B  3003 8D1D2C  3004 701F29  3005 5E2028
3007 402225  3009 703731  3011 7E292C  3012 CB8D73  3013 9C322E  3014 D47479  3015 E1A6AD  3016 AC4034  3017 D3545F  3018 D14152
3020 C1121C  3022 D56D56  3024 F70000  3026 FF0000  3027 B42041  3028 E72512  3031 AC323B  3032 711521  3033 B24C43  4001 8A5A83
4002 933D50  4003 D15B8F  4004 691639  4005 83639D  4006 992572  4007 4A203B  4008 904684  4009 A38995  4010 C63678  4011 8773A1
4012 6B6880  5000 384C70  5001 1F4764  5002 2B2C7C  5003 2A3756  5004 1D1F2A  5005 154889  5007 41678D  5008 313C48  5009 2E5978
5010 13447C  5011 232C3F  5012 3481B8  5013 232D53  5014 6C7C98  5015 2874B2  5017 0E518D  5018 21888F  5019 1A5784  5020 0B4151
5021 07737A  5022 2F2A5A  5023 4D668E  5024 6A93B0  5025 296478  5026 102C54  6000 327662  6001 28713E  6002 276235  6003 4B573E
6004 0E4243  6005 0F4336  6006 40433B  6007 283424  6008 35382E  6009 26392F  6010 3E753B  6011 68825B  6012 31403D  6013 797C5A
6014 444337  6015 3D403A  6016 026A52  6017 468641  6018 48A43F  6019 B7D9B1  6020 354733  6021 86A47C  6022 3E3C32  6024 008754
6025 53753C  6026 005D52  6027 81C0BB  6028 2D5546  6029 007243  6032 0F8558  6033 478A84  6034 7FB0B2  6035 1B542C  6036 005D4C
6037 25E712  6038 00F700  7000 7E8B92  7001 8F999F  7002 817F68  7003 7A7B6D  7004 9EA0A1  7005 6B716F  7006 756F61  7008 746643
7009 5B6259  7010 575D57  7011 555D61  7012 596163  7013 555548  7015 51565C  7016 373F43  7021 2E3234  7022 4B4D46  7023 818479
7024 474A50  7026 374447  7030 939388  7031 5D6970  7032 B9B9A8  7033 818979  7034 939176  7035 CBD0CC  7036 9A9697  7037 7C7F7E
7038 B4B8B0  7039 6B695F  7040 9DA3A6  7042 8F9695  7043 4E5451  7044 BDBDB2  7045 91969A  7046 82898E  7047 CFD0CF  7048 888175
8000 887142  8001 9C6B30  8002 7B5141  8003 80542F  8004 8F4E35  8007 6F4A2F  8008 6F4F28  8011 5A3A29  8012 673831  8014 49392D
8015 633A34  8016 4C2F26  8017 44322D  8019 3F3A3A  8022 211F20  8023 A65E2F  8024 79553C  8025 755C49  8028 4E3B2B  8029 773C27
9001 EFEBDC  9002 DDDED4  9003 F4F8F4  9004 2E3032  9005 0A0A0D  9006 A5A8A6  9007 8F8F8C  9010 F7F9EF  9011 292C2F  9012 FFFDE6
9016 F7FBF5  9017 2A2D2F  9018 CFD3CD  9022 9C9C9C  9023 7E8182
`;

  static CODES = Object.fromEntries(
    RalColor.TABLE.trim()
      .split(/\s{2,}|\n/)
      .map(pair => pair.split(' ')),
  );

  static NAMED = [
    [/красн/, '#B3261E'],
    [/оранж/, '#E2711D'],
    [/ж[её]лт/, '#E8B21A'],
    [/з[её]л[её]н/, '#2E7D4F'],
    [/голуб/, '#4A90C8'],
    [/син/, '#1E4D8C'],
    [/фиолет/, '#5B3E8C'],
    [/коричн/, '#6B4A2F'],
    [/ч[её]рн/, '#2A2D30'],
    [/бел/, '#F1F2F0'],
    [/серебр|алюмин|нерж|оцинк|металлик/, '#B9BEC3'],
    [/графит|антрацит/, '#3B4045'],
    [/сер/, '#8E959C'],
    [/беж/, '#D8C8A8'],
  ];

  /**
   * Коды RAL в тексте: «RAL7004/5005» → [{ code: 'RAL 7004', hex }, { code: 'RAL 5005', hex }].
   * @param {unknown} text
   * @returns {{ code: string, hex: string }[]}
   */
  static codes(text) {
    const clean = String(text || '');
    const start = clean.search(/RAL/i);
    if (start < 0) return [];
    return [...clean.slice(start).matchAll(/(?:^|\D)(\d{4})(?!\d)/g)]
      .map(match => match[1])
      .filter(code => this.CODES[code])
      .map(code => ({ code: `RAL ${code}`, hex: `#${this.CODES[code]}` }));
  }

  /** @returns {string | null} условный цвет по названию («синий», «серый») */
  static named(text) {
    const clean = String(text || '').toLowerCase();
    const hit = this.NAMED.find(([pattern]) => pattern.test(clean));
    return hit ? hit[1] : null;
  }

  /** @returns {number[]} [r, g, b] */
  static rgb(hex) {
    const num = parseInt(String(hex).replace('#', ''), 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }

  /** Цвет «#rrggbb» из каналов. */
  static hex(red, green, blue) {
    const byte = v =>
      Math.max(0, Math.min(255, Math.round(v)))
        .toString(16)
        .padStart(2, '0');
    return `#${[red, green, blue].map(byte).join('')}`;
  }

  /** k < 1 — темнее, k > 1 — светлее (к белому). */
  static shade(hex, k) {
    const channels = this.rgb(hex);
    if (k <= 1) return this.hex(...channels.map(v => v * k));
    return this.hex(...channels.map(v => v + (255 - v) * Math.min(1, k - 1)));
  }

  /** Смесь двух цветов в доле. */
  static mix(from, till, part) {
    const y = this.rgb(till);
    return this.hex(...this.rgb(from).map((v, i) => v + (y[i] - v) * part));
  }

  /** @returns {number} яркость 0…1 — подпись на цвете тёмная или светлая */
  static light(hex) {
    const [red, green, blue] = this.rgb(hex);
    return (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
  }
}
