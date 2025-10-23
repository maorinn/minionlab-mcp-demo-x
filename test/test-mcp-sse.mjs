// MCP 服务 SSE 测试脚本 (Node.js 版本)
// 首先需要安装依赖: npm install eventsource node-fetch

// 导入必要的库
import { EventSource } from 'eventsource';
import fetch from 'node-fetch';

const testMcpServiceWithSSE = (url, token = null, params = {}) => {
    console.log('开始连接 MCP 服务 SSE...');

    // 构建 URL 及参数
    const queryParams = new URLSearchParams(params).toString();
    const fullUrl = queryParams ? `${url}?${queryParams}` : url;

    // 创建 EventSource 连接选项
    const eventSourceOptions = {};

    if (token) {
        eventSourceOptions.headers = {
            'Authorization': `Bearer ${token}`
        };
    }

    let eventSource;

    try {
        // 使用 eventsource 库创建连接
        eventSource = new EventSource(fullUrl, eventSourceOptions);
        console.log('创建 SSE 连接', fullUrl, eventSourceOptions);
        // 连接成功
        eventSource.onopen = (event) => {
            console.log('SSE 连接已建立');
        };

        // 接收消息
        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('收到 SSE 消息:', data);

                // 可以在这里添加特定的消息处理逻辑
                if (data.status === 'complete') {
                    console.log('操作已完成');
                } else if (data.status === 'error') {
                    console.error('操作出错:', data.errorMessage);
                }
            } catch (err) {
                console.error('解析 SSE 消息出错:', err, event.data);
            }
        };

        // 监听错误
        eventSource.onerror = (error) => {
            console.error('SSE 连接错误:', error);
            // 可以实现重连逻辑
            if (eventSource.readyState === EventSource.CLOSED) {
                console.log('连接已关闭，尝试重新连接...');
                // 重连逻辑
            }
        };

        // 监听自定义事件类型
        eventSource.addEventListener('progress', (event) => {
            try {
                const progressData = JSON.parse(event.data);
                console.log('进度更新:', progressData);
            } catch (err) {
                console.error('解析进度消息出错:', err);
            }
        });

        // 返回事件源对象，方便外部控制
        return {
            eventSource,
            close: () => {
                console.log('关闭 SSE 连接');
                eventSource.close();
            }
        };
    } catch (error) {
        console.error('创建 SSE 连接出错:', error);
        return null;
    }
};

// 使用示例
const main = async () => {
    // MCP 服务的 SSE 端点
    const sseUrl = 'http://localhost:3001/sse';

    // 认证令牌（如需要）
    const authToken = 'your-auth-token';

    // 请求参数（根据需要配置）
    const requestParams = {};

    // 建立 SSE 连接
    const sseConnection = testMcpServiceWithSSE(sseUrl, authToken, requestParams);

    if (sseConnection) {
        console.log('SSE 连接已建立，等待消息...');

        // 设置一个超时关闭连接
        setTimeout(() => {
            console.log('测试时间结束，关闭连接');
            sseConnection.close();

            // 在 Node.js 环境中，可能需要显式退出程序
            console.log('测试完成，退出程序');
            process.exit(0);
        }, 60000); // 60秒后关闭
    }
};

// 运行测试
main().catch(error => {
    console.error('测试过程中出错:', error);
    process.exit(1);
});