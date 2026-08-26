@echo off
REM gerar_roadmap.bat
REM Duplo clique pra rodar "node azure.js" sem precisar abrir terminal na mao.
REM Na primeira vez (ou depois de gerar um PAT novo), ele pede o token e salva
REM permanentemente na sua conta do Windows (setx) -- nas proximas vezes nao
REM pergunta de novo, a menos que voce apague a variavel ou o token vença.

setlocal enabledelayedexpansion

REM Garante que estamos rodando a partir da pasta onde este .bat esta salvo,
REM nao da pasta em que o Windows abriu o cmd.
cd /d "%~dp0"

if "%AZURE_DEVOPS_PAT%"=="" (
    echo Variavel AZURE_DEVOPS_PAT nao encontrada.
    echo.
    set /p PAT_INPUT="Cole aqui o seu Personal Access Token do Azure DevOps e aperte Enter: "
    setx AZURE_DEVOPS_PAT "!PAT_INPUT!" >nul
    set "AZURE_DEVOPS_PAT=!PAT_INPUT!"
    echo.
    echo Token salvo. Da proxima vez nao vai precisar colar de novo.
    echo ^(Se o Azure disser que o token venceu, so rodar este .bat de novo que ele pede um novo^)
    echo.
)

node azure.js

if errorlevel 1 (
    echo.
    echo ============================================
    echo O comando falhou ^(veja o erro acima -- provavelmente o token venceu^).
    set /p RETRY="Quer colar um token novo e tentar de novo agora? (S/N): "
    if /i "!RETRY!"=="S" (
        set /p PAT_INPUT="Cole o novo Personal Access Token e aperte Enter: "
        setx AZURE_DEVOPS_PAT "!PAT_INPUT!" >nul
        set "AZURE_DEVOPS_PAT=!PAT_INPUT!"
        echo.
        echo Tentando de novo...
        echo.
        node azure.js
    )
)

echo.
echo ============================================
echo Pressione qualquer tecla para fechar esta janela...
pause >nul
