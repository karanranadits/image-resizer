FROM nginx:alpine

# Copy static files to Nginx's default HTML directory
COPY . /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
