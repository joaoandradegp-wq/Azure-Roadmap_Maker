@echo off
REM rodar_sync.bat
REM Duplo clique pra rodar "node sync.js" sem precisar abrir terminal na mao
REM e sem deixar o PAT guardado em nenhum arquivo dentro da pasta do projeto.
REM
REM Usa a MESMA variavel de ambiente AZURE_DEVOPS_PAT do projeto
REM Azure-Roadmap_Maker -- ou seja, se voce ja colou o token la (pelo
REM gerar_roadmap.bat), este .bat ja enxerga o mesmo token automaticamente,
REM sem precisar colar de novo aqui.

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
    echo Token salvo. Da proxima vez nao vai precisar colar de novo
    echo ^(nem aqui, nem no Azure-Roadmap_Maker -- e o mesmo token pros dois^).
    echo.
)

echo Lembrete: feche a planilha no Excel antes de continuar, senao o
echo Windows trava o arquivo pra escrita.
echo.
pause

node sync.js

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
        node sync.js
    )
)

echo.
echo ============================================
echo Pressione qualquer tecla para fechar esta janela...
pause >nul
