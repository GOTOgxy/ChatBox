const SITES = [
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    url: 'https://chatgpt.com/',
    domains: ['chatgpt.com', 'openai.com', 'auth0.com'],
    color: '#10a37f',
    letter: 'C'
  },
  {
    id: 'gemini',
    name: 'Gemini',
    url: 'https://gemini.google.com/',
    domains: ['google.com'],
    color: '#4285f4',
    letter: 'G'
  },
  {
    id: 'qwen',
    name: '千问',
    url: 'https://www.qianwen.com/',
    domains: ['qianwen.com', 'tongyi.com', 'aliyun.com', 'taobao.com', 'mmstat.com'],
    color: '#615ced',
    letter: 'Q'
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    url: 'https://chat.deepseek.com/',
    domains: ['deepseek.com'],
    color: '#4d6bfe',
    letter: 'D'
  }
];

if (typeof module !== 'undefined') module.exports = { SITES };
