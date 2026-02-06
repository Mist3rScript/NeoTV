@echo off
echo ===================================================
echo Starting Manual Deployment to Vercel...
echo ===================================================
echo.
echo Step 1: Installing/Checking Vercel CLI...
echo Step 2: logging in to Vercel (Follow instructions in browser)...
call npx vercel login
echo.
echo Step 3: Deploying Backend...
echo IMPORTANT: Validating project settings...
call npx vercel link --yes
echo.
echo Uploading files...
call npx vercel --prod
echo.
echo ===================================================
echo Deployment Complete! Check the URL above.
echo ===================================================
pause
