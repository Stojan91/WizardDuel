FROM python:3.11-slim
WORKDIR /app
COPY server_web.py assets/ requirements.txt ./
RUN pip install websockets pillow numpy
EXPOSE 8080
CMD ["python", "server_web.py"]
