# AI RecPaper Hub

推荐算法论文聚合平台 —— 自动从 [arXiv](https://arxiv.org) 抓取推荐系统领域的最新研究论文，提供中文翻译。

## 功能

- **实时检索**：通过 arXiv API 获取最新推荐系统论文
- **关键词搜索**：支持按关键词搜索特定方向的论文
- **分类筛选**：按 cs.IR / cs.LG / cs.AI 等分类过滤
- **中文翻译**：一键将英文摘要翻译为中文（MyMemory API）
- **本地缓存**：翻译结果缓存到 localStorage，避免重复请求

## 技术架构

- 纯前端静态站点，无后端依赖
- GitHub Pages 托管
- CORS 代理解决跨域问题（corsproxy.io / allorigins.win）
- 响应式设计，支持移动端

## 本地开发

```bash
cd catsketch960.github.io
python3 -m http.server 8080
# 打开 http://localhost:8080
```

## 部署

推送到 `main` 分支即自动部署到 GitHub Pages。

## 许可

论文数据来源 [arXiv.org](https://arxiv.org)，遵循 arXiv 使用条款。
