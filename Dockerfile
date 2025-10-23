FROM node:18-alpine

# 设置工作目录
WORKDIR /app

# 复制package.json和package-lock.json（如果存在）
COPY package*.json ./

# 安装依赖
RUN npm install pnpm -g && pnpm install --ignore-scripts

# 复制源代码
COPY . .

# 构建应用（如果需要）
RUN npm run build

# 暴露端口
EXPOSE 3001

# 启动命令
CMD ["npm", "start"]