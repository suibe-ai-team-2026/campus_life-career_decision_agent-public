#!/usr/bin/env python3
"""
Genote Workflow Bug 修复脚本 V5
使用精确匹配修复三个主要问题
"""

def main():
    # 读取 0.3 版本文件
    with open('/Users/qinhao/Documents/python/VS_code_python/Genote_beta_0.3.yml', 'r', encoding='utf-8') as f:
        content = f.read()
    
    # ===== 修复 1: 简化 detect_subject_hint，强制走 LLM =====
    # 找到整个 detect_subject_hint 函数并替换
    old_func_start = '''\\ndef detect_subject_hint(file_name: str) -\u003e\\
          \\ str:\\n    \\\"\\\"\\\"\\n    通过文件名关键词快速预判定学科类别。\\n    若无法判定，则标记为 'auto'，交由下游极简\\
          \\ LLM 节点识别。\\n    \\\"\\\"\\\"\\n    # 定义高频学科关键词字典 (Token 消耗为 0)\\n    keyword_map\\
          \\ = {\\n        \\\"考研政治\\\": [\\\"政治\\\", \\\"马原\\\", \\\"毛概\\\", \\\"思修\\\", \\\"史纲\\\", \\\"肖秀荣\\\"\\
          ],\\n        \\\"法律/法考\\\": [\\\"法律\\\", \\\"刑法\\\", \\\"民法\\\", \\\"宪法\\\", \\\"诉讼\\\", \\\"法理\\\"],\\n\\
          \\        \\\"公务员考试\\\": [\\\"行测\\\", \\\"申论\\\", \\\"公考\\\", \\\"常识判断\\\", \\\"资料分析\\\"],\\n    \\
          \\    \\\"考研数学/理工\\\": [\\\"高数\\\", \\\"线性代数\\\", \\\"微积分\\\", \\\"物理\\\", \\\"力学\\\", \\\"电路\\\"],\\n\\
          \\        \\\"临床医学\\\": [\\\"解剖\\\", \\\"病理\\\", \\\"生理\\\", \\\"内科\\\", \\\"外科\\\", \\\"药理\\\"],\\n \\
          \\       \\\"计算机/IT\\\": [\\\"数据结构\\\", \\\"操作系统\\\", \\\"算法\\\", \\\"编程\\\", \\\"代码\\\", \\\"后端\\\"\\
          ]\\n    }\\n    \\n    file_name_lower = file_name.lower()\\n    for subject,\\
          \\ keywords in keyword_map.items():\\n        if any(kw in file_name_lower\\
          \\ for kw in keywords):\\n            return subject\\n            \\n    #\\
          \\ 如果文件名没有明显关键词，返回 auto 触发后续 LLM 识别\\n    return \\\"auto\\\"\\n'''
    
    new_func = '''\\ndef detect_subject_hint(file_name: str) -\u003e\\
          \\ str:\\n    \\\"\\\"\\\"\\n    始终返回 auto，强制走 LLM 智能识别学科。\\n    \\\"\\\"\\\"\\n    return \\\"auto\\\"\\n'''
    
    content = content.replace(old_func_start, new_func)
    
    # ===== 修复 2: 优化 subject_classifier LLM 提示词 =====
    old_prompt = '''text: '你是学科分类专家。请根据片段内容及用户指令，输出最匹配的学科名称（例如：行政管理学、生物化学、中国文学）。 要求：只输出学科名，不要任何废话。

            \''''
    
    new_prompt = '''text: '你是学科分类专家。请根据内容判断所属学科。

            规则：1.只输出一个学科名称（如高等数学、刑法学、行政管理学）2.无法确定则输出通用学术 3.不要任何解释

            \''''
    
    content = content.replace(old_prompt, new_prompt)
    
    # ===== 修复 3: 增强纯文字输入的处理 =====
    # 在 reduce_aggregate 中添加对 original_query 的直接处理
    old_empty_check = "if not map_results or all(not r for r in map_results):"
    new_empty_check = '''# 优先检查是否有用户文本输入
        if original_query and original_query.strip() and (not map_results or all(not r for r in map_results)):
            # 纯文字输入场景：基于用户输入生成笔记
            return generate_notes_from_text(original_query, subject_hint)
        
        if not map_results or all(not r for r in map_results):'''
    
    content = content.replace(old_empty_check, new_empty_check)
    
    # 添加 generate_notes_from_text 函数
    notes_func = '''def generate_notes_from_text(text: str, subject_hint: str) -> dict:\\n\\
          \\    \\"\\"\\"\\"\\n    基于用户纯文字输入直接生成笔记\\n    \\"\\"\\"\\"\\n    subject = subject_hint if subject_hint and subject_hint != \\"auto\\" else \\"通用学术\\"\\n    notes = f\\"# 📚 {subject}学习笔记\\\\n\\\\n## 📝 内容记录\\\\n\\\\n{text}\\\\n\\\\n## 💡 学习建议\\\\n\\\\n请基于以上内容进行深入学习和复习。\\"\\n    return {\\n        \\"final_notes\\": notes,\\n        \\"total_points\\": 1,\\n        \\"key_concepts\\": [],\\n        \\"error_message\\": \\"\\"\\n    }\\n\\n'''
    
    content = content.replace(
        "def generate_fallback_notes(",
        notes_func + "def generate_fallback_notes("
    )
    
    # ===== 修复 4: 优化错误提示 =====
    old_error = '''answer: '## ⚠️ 处理遇到问题

          **错误信息**: {{#1766496837552.error_message#}}

          如需帮助，请参考以下建议：

          1. 检查文件格式是否为支持的类型（PDF、PPT、Word、音频、图片）

          2. 确认文件大小在限制范围内（最大 200MB）

          3. 对于超长录音，请分段上传\''''
    
    new_error = '''answer: '## ⚠️ 文件处理提示

          {{#1766496837552.error_message#}}

          ---
          **支持格式**: PDF、Word、PPT、Excel、音频、视频、图片
          **大小限制**: 最大200MB
          **建议**: 请检查文件格式后重新上传\''''
    
    content = content.replace(old_error, new_error)
    
    # ===== 修复 5: 修改 "是否需要AI识别" 节点的条件，让它始终走 LLM =====
    # 当前条件是 subject_hint != auto 时走 true 分支（跳过 LLM）
    # 由于我们让 detect_subject_hint 始终返回 auto，所以条件永远为 false
    # 这样就会走 false 分支 -> text_previewer -> subject_classifier
    # 这个逻辑现在是正确的，不需要修改

    # 写入新版本
    output_path = '/Users/qinhao/Documents/python/VS_code_python/Genote_beta_0.4.yml'
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(content)
    
    print(f"✅ 修复完成，已保存到: {output_path}")
    
    # 验证
    print("\n验证关键修改:")
    with open(output_path, 'r', encoding='utf-8') as f:
        out = f.read()
    
    checks = [
        ("始终返回 auto，强制走 LLM 智能识别", "subject_hint 强制 LLM"),
        ("generate_notes_from_text", "纯文字处理函数"),
        ("只输出一个学科名称", "优化后的 LLM 提示词"),
        ("文件处理提示", "优化后的错误信息"),
        ("优先检查是否有用户文本输入", "纯文字输入优先处理"),
    ]
    
    all_ok = True
    for keyword, desc in checks:
        if keyword in out:
            print(f"  ✅ {desc}")
        else:
            print(f"  ❌ {desc}")
            all_ok = False
    
    if all_ok:
        print("\n🎉 所有修复已成功应用!")
    else:
        print("\n⚠️ 部分修复未成功")

if __name__ == "__main__":
    main()
