// 由 tools/prize-pairs.json 发布。面板保存配额或新建一对时重写，不要手改。
export const PRIZE_ROWS = [
  {
    "id": "bread",
    "name": "面包",
    "truthName": "发霉面包",
    "category": "food",
    "quest": true,
    "questLabel": "面包",
    "dish": "面包汤",
    "gripFactor": 0.95,
    "bounceMaterial": "soft",
    "collider": {
      "shape": "box",
      "size": [
        0.18,
        0.1,
        0.11
      ]
    },
    "visual": {
      "type": "primitive",
      "color": 13148266
    },
    "variants": {
      "rot": {
        "to": "moldy"
      }
    }
  },
  {
    "id": "can",
    "name": "罐头",
    "truthName": "锈罐头",
    "category": "food",
    "quest": true,
    "questLabel": "罐头",
    "dish": "罐头",
    "gripFactor": 0.85,
    "bounceMaterial": "metal",
    "collider": {
      "shape": "cylinder",
      "size": [
        0.052,
        0.13
      ]
    },
    "visual": {
      "type": "primitive",
      "color": 12172998
    },
    "variants": {
      "rot": {
        "to": "rustcan"
      }
    }
  },
  {
    "id": "veg",
    "name": "青菜",
    "truthName": "烂菜",
    "category": "food",
    "quest": true,
    "questLabel": "蔬菜",
    "dish": "烫青菜",
    "gripFactor": 0.9,
    "bounceMaterial": "soft",
    "collider": {
      "shape": "sphere",
      "size": [
        0.075,
        0.65
      ]
    },
    "visual": {
      "type": "primitive",
      "color": 8363098
    },
    "variants": {
      "rot": {
        "to": "rot"
      }
    }
  },
  {
    "id": "carton",
    "name": "牛奶盒",
    "truthName": "空盒",
    "category": "food",
    "quest": false,
    "questLabel": "牛奶盒",
    "dish": "热牛奶",
    "gripFactor": 0.95,
    "bounceMaterial": "rubber",
    "collider": {
      "shape": "box",
      "size": [
        0.12,
        0.15,
        0.09
      ]
    },
    "visual": {
      "type": "primitive",
      "color": 14077888
    },
    "variants": {
      "rot": {
        "to": "carton-rot"
      }
    }
  },
  {
    "id": "cheese",
    "name": "干酪块",
    "truthName": "霉斑块",
    "category": "food",
    "quest": false,
    "questLabel": "干酪块",
    "dish": "烤干酪",
    "gripFactor": 0.9,
    "bounceMaterial": "soft",
    "collider": {
      "shape": "box",
      "size": [
        0.11,
        0.08,
        0.09
      ]
    },
    "visual": {
      "type": "primitive",
      "color": 14267983
    },
    "variants": {
      "rot": {
        "to": "cheese-rot"
      }
    }
  },
  {
    "id": "bottle",
    "name": "瓶子",
    "truthName": "裂瓶",
    "category": "food",
    "quest": false,
    "questLabel": "瓶子",
    "dish": "热糖水",
    "gripFactor": 0.7,
    "bounceMaterial": "glass",
    "collider": {
      "shape": "cylinder",
      "size": [
        0.045,
        0.17
      ]
    },
    "visual": {
      "type": "primitive",
      "color": 8164262
    },
    "variants": {
      "rot": {
        "to": "bottle-rot"
      }
    }
  },
  {
    "id": "jar",
    "name": "玻璃罐",
    "truthName": "裂罐",
    "category": "food",
    "quest": false,
    "questLabel": "玻璃罐",
    "dish": "果酱",
    "gripFactor": 0.65,
    "bounceMaterial": "glass",
    "collider": {
      "shape": "cylinder",
      "size": [
        0.06,
        0.14
      ]
    },
    "visual": {
      "type": "primitive",
      "color": 10466476
    },
    "variants": {
      "rot": {
        "to": "jar-rot"
      }
    }
  },
  {
    "id": "apple",
    "name": "果子",
    "truthName": "瘪果",
    "category": "food",
    "quest": false,
    "questLabel": "果子",
    "dish": "糖水果",
    "gripFactor": 0.75,
    "bounceMaterial": "soft",
    "collider": {
      "shape": "sphere",
      "size": [
        0.06,
        0.95
      ]
    },
    "visual": {
      "type": "primitive",
      "color": 11032394
    },
    "variants": {
      "rot": {
        "to": "apple-rot"
      }
    }
  },
  {
    "id": "fish",
    "name": "咸鱼",
    "truthName": "腐烂的咸鱼",
    "category": "food",
    "quest": false,
    "questLabel": "咸鱼",
    "dish": "蒸咸鱼",
    "gripFactor": 0.85,
    "bounceMaterial": "soft",
    "collider": {
      "shape": "box",
      "size": [
        0.2,
        0.06,
        0.09
      ]
    },
    "visual": {
      "type": "primitive",
      "color": 12888194
    },
    "variants": {
      "rot": {
        "to": "fish-rot"
      }
    }
  },
  {
    "id": "ration",
    "name": "口粮袋",
    "truthName": "空瘪袋",
    "category": "food",
    "quest": false,
    "questLabel": "口粮袋",
    "dish": "口粮粥",
    "gripFactor": 0.9,
    "bounceMaterial": "rubber",
    "collider": {
      "shape": "sphere",
      "size": [
        0.09,
        0.8
      ]
    },
    "visual": {
      "type": "primitive",
      "color": 12760202
    },
    "variants": {
      "rot": {
        "to": "ration-rot"
      }
    }
  },
  {
    "id": "cracker",
    "name": "饼干盒",
    "truthName": "受潮纸盒",
    "category": "food",
    "quest": false,
    "questLabel": "饼干盒",
    "dish": "饼干",
    "gripFactor": 0.9,
    "bounceMaterial": "rubber",
    "collider": {
      "shape": "box",
      "size": [
        0.16,
        0.07,
        0.12
      ]
    },
    "visual": {
      "type": "primitive",
      "color": 14206112
    },
    "variants": {
      "rot": {
        "to": "cracker-rot"
      }
    }
  },
  {
    "id": "oil",
    "name": "油瓶",
    "truthName": "浑浊油瓶",
    "category": "food",
    "quest": false,
    "questLabel": "油瓶",
    "dish": "油拌饭",
    "gripFactor": 0.6,
    "bounceMaterial": "glass",
    "collider": {
      "shape": "cylinder",
      "size": [
        0.042,
        0.19
      ]
    },
    "visual": {
      "type": "primitive",
      "color": 13022570
    },
    "variants": {
      "rot": {
        "to": "oil-rot"
      }
    }
  },
  {
    "id": "fruit2",
    "name": "青果",
    "truthName": "烂青果",
    "category": "food",
    "quest": false,
    "questLabel": "青果",
    "dish": "煮青果",
    "gripFactor": 0.75,
    "bounceMaterial": "soft",
    "collider": {
      "shape": "sphere",
      "size": [
        0.058,
        0.9
      ]
    },
    "visual": {
      "type": "primitive",
      "color": 8362570
    },
    "variants": {
      "rot": {
        "to": "fruit2-rot"
      }
    }
  },
  {
    "id": "drumstick",
    "name": "鸡腿",
    "truthName": "鸡腿（败露）",
    "category": "food",
    "quest": false,
    "questLabel": "鸡腿",
    "dish": "照烧鸡腿",
    "gripFactor": 0.85,
    "bounceMaterial": "soft",
    "collider": {
      "shape": "box",
      "size": [
        0.12,
        0.1,
        0.1
      ]
    },
    "visual": {
      "type": "primitive",
      "color": 11575440
    },
    "variants": {
      "rot": {
        "to": "drumstick-rot"
      }
    }
  }
];

export const QUEST_MENU = {
  "ids": [
    "bread",
    "can",
    "veg"
  ],
  "cards": [
    "面包汤",
    "罐头",
    "烫青菜"
  ],
  "line": "今日菜单\n面包汤 · 罐头 · 烫青菜"
};
