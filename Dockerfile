# Stage 1: Build Stage
# Use an official Node.js runtime as a parent image.
# Alpine Linux is used for its small size.
FROM node:18-alpine AS build

# Set the working directory in the container.
WORKDIR /usr/src/app

# Copy package.json and package-lock.json to leverage Docker's layer caching.
# The 'npm install' step will only be re-run if these files change.
COPY package*.json ./

# Install all dependencies, including devDependencies for any build scripts.
RUN npm install

# Copy the rest of the application's source code.
COPY . .

# (Optional) Add a build step here if you were using TypeScript or a bundler.
# RUN npm run build

# Stage 2: Production Stage
# Start from a fresh, minimal Node.js image.
FROM node:18-alpine

# Set timezone to China Standard Time
ENV TZ=Asia/Shanghai
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# Set the working directory.
WORKDIR /usr/src/app

# Copy only the necessary files from the build stage.
# This includes production node_modules and the application code.
COPY --from=build /usr/src/app/node_modules ./node_modules
COPY --from=build /usr/src/app/package.json ./package.json
COPY --from=build /usr/src/app/index.js ./
COPY --from=build /usr/src/app/worker.js ./
COPY --from=build /usr/src/app/logger.js ./

# Set the NODE_ENV to 'production' for performance optimizations.
ENV NODE_ENV=production

# Expose the health check port.
EXPOSE 3000

# Define the command to run the application.
# Use an array to avoid shell parsing issues.
CMD [ "node", "index.js" ]
