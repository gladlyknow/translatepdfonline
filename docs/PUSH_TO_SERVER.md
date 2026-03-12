# 推送到 10.254.128.253 说明

## 已完成的准备

1. **根目录 `.gitignore`**  
   已添加并排除：
   - Python：`.venv/`、`venv/`、`__pycache__/`、`*.pyc`、`.env`、`.env.*` 等  
   - Node：`node_modules/`、`.next/`、`out/`、`.vercel` 等  

2. **从 Git 跟踪中移除**  
   已对 `.venv`、`.env`、`.env.local`、`node_modules` 执行 `git rm -r --cached`，后续提交中不再包含这些目录/文件。

3. **远程仓库**  
   已添加远程 `deploy`，指向：
   ```text
   10.254.128.253:/android/translate/repo.git
   ```

4. **本地提交**  
   已提交：`chore: add root .gitignore and remove Python/Node env from tracking`。

## 你需要完成的：SSH 与推送

推送时出现 **Permission denied (publickey,password)** 表示当前本机到 10.254.128.253 的 SSH 认证未通过，需要你先配置好再执行推送。

### 方式一：使用 SSH 密钥（推荐）

1. 在本机生成密钥（若还没有）：
   ```bash
   ssh-keygen -t ed25519 -C "your_email@example.com"
   ```
2. 将公钥（如 `~/.ssh/id_ed25519.pub`）内容追加到服务器 `10.254.128.253` 上对应用户的 `~/.ssh/authorized_keys`。
3. 若服务器上的 Git 仓库用户不是当前 SSH 默认用户，可修改远程 URL 再推送：
   ```bash
   git remote set-url deploy 用户名@10.254.128.253:/android/translate/repo.git
   git push deploy master
   ```

### 方式二：使用用户名 + 密码

若服务器只允许密码登录，可把远程改为显式用户名（把 `用户名` 换成你在 10.254.128.253 上的登录名）：

```bash
git remote set-url deploy 用户名@10.254.128.253:/android/translate/repo.git
git push deploy master
```

按提示输入该用户在 10.254.128.253 上的登录密码。

### 推送命令

在项目根目录执行：

```bash
git push deploy master
```

若远程仓库是空仓库或希望用当前分支覆盖远程默认分支，上述命令即可。若服务器上希望使用 `main` 分支，可先在本机重命名分支再推送，或在服务器端调整默认分支。

## 服务器端仓库位置

- 裸仓库路径：`/android/translate/repo.git`  
- 推送后，在服务器上如需工作目录，可在 `/android/translate/` 下执行：
  ```bash
  git clone /android/translate/repo.git ./app
  # 或已存在目录时
  cd /android/translate/app && git pull
  ```

工作目录将位于 `/android/translate/app`（或你 clone 时指定的目录）下，不包含 Python/Node 环境，需在服务器上自行创建 `venv`、安装 `node_modules` 等。

---

## Push 后自动更新工作目录（post-receive hook）

希望每次 `git push deploy master` 后，服务器自动执行「进入 `/android/translate` → 若已有 `translatepdfonline` 则 `git pull`，否则 `git clone` 为 `translatepdfonline`」时，在 **10.254.128.253 上** 安装 hook 即可。

### 一次性安装（在服务器上执行）

```bash
# SSH 登录到 10.254.128.253 后
cp /android/translate/translatepdfonline/scripts/hooks/post-receive /android/translate/repo.git/hooks/post-receive
chmod +x /android/translate/repo.git/hooks/post-receive
```

若尚未有工作目录，可先手动 clone 一次，再复制 hook（或从本机 scp 脚本到服务器）：

```bash
cd /android/translate
git clone /android/translate/repo.git translatepdfonline
cp /android/translate/translatepdfonline/scripts/hooks/post-receive /android/translate/repo.git/hooks/post-receive
chmod +x /android/translate/repo.git/hooks/post-receive
```

### 行为说明

- 每次向 `repo.git` push 后，hook 会：
  1. `cd /android/translate`
  2. 若存在目录 `translatepdfonline`：进入后执行 `git pull`
  3. 若不存在：执行 `git clone /android/translate/repo.git translatepdfonline` 并 `cd translatepdfonline`

脚本位于仓库内：`scripts/hooks/post-receive`，便于随代码一起推送，在服务器上按上面步骤复制到 `repo.git/hooks/` 即可生效。
