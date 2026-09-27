# ---------- 构建阶段 ----------
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .
# 构建不依赖 VITE_AMAP_KEY：未配置时产物自动走本地 SVG 网格视图
RUN npm run build

# ---------- 运行阶段 ----------
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
# 宿主 umask 会把文件建成 0600，nginx worker 读不到静态资源（favicon 会 403）
RUN chmod -R a+rX /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
