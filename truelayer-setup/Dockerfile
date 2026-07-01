FROM node:24-alpine
WORKDIR /app
COPY package.json ./
RUN npm install
# server.js is bind-mounted at runtime from the host
ENV DATA_DIR=/app/data
EXPOSE 3099
CMD ["node_modules/.bin/nodemon", "--watch", "server.js", "server.js"]
