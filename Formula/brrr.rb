class Brrr < Formula
  desc "Webhook notifications for Claude Code and Codex"
  homepage "https://github.com/simonbs/brrr-cli"
  url "https://github.com/simonbs/brrr-cli/archive/refs/tags/v0.1.2.tar.gz"
  sha256 "404bdc11d85b5159ad6ebb0b0861a3686a85745795fe050841c525858c0a1acf"
  head "https://github.com/simonbs/brrr-cli.git", branch: "main"

  depends_on "node"

  def install
    system "npm", "ci"
    system "npm", "run", "build"
    system "npm", "prune", "--omit=dev"

    libexec.install Dir["*"]
    (bin/"brrr").write_exec_script libexec/"dist/src/cli.js"
  end

  test do
    assert_match "Usage: brrr", shell_output("#{bin}/brrr --help")
  end
end
