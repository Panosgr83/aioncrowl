from setuptools import setup, find_packages

setup(
    name="aionclaw",
    version="1.0.0",
    description="AIONCLAW — multi-agent AI system with Telegram bots",
    packages=find_packages(),
    python_requires=">=3.10",
    install_requires=[
        "fastapi>=0.110.0",
        "uvicorn[standard]>=0.27.0",
        "websockets>=12.0",
        "pydantic>=2.5.0",
        "httpx>=0.27.0",
        "apscheduler>=3.10.0",
        "python-multipart>=0.0.6",
        "aiofiles>=23.2.0",
        "beautifulsoup4>=4.12.0",
        "lxml>=5.1.0",
        "requests>=2.31.0",
    ],
    extras_require={
        "dev": ["pytest>=8.0", "httpx>=0.27.0"],
    },
    entry_points={
        "console_scripts": [
            "aionctl=aionctl:cli",
        ],
    },
    url="https://github.com/anomalyco/aionclaw",
)
