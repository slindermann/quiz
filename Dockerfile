FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY . .

RUN mkdir -p /app/uploads

EXPOSE 3000

CMD ["node", "server.js"]
